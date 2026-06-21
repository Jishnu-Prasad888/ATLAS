use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::process::Command;

use super::trait_collector::Collector;
use crate::config::CollectorFlags;

#[derive(Clone, Debug, Default)]
struct GpuSample {
    index: u32,
    uuid: String,
    name: String,
    utilization_pct: f64,
    memory_total_mb: f64,
    memory_used_mb: f64,
    memory_util_pct: f64,
    temperature_c: f64,
    fan_speed_pct: Option<f64>,
    power_draw_w: Option<f64>,
    power_limit_w: Option<f64>,
    graphics_clock_mhz: Option<f64>,
    sm_clock_mhz: Option<f64>,
    mem_clock_mhz: Option<f64>,
    pci_bus: Option<String>,
}

pub struct GpuCollector {
    flags: CollectorFlags,
}

impl GpuCollector {
    pub fn new(flags: CollectorFlags) -> Self {
        Self { flags }
    }

    fn build_payload(
        samples: &[GpuSample],
        collector_disabled: bool,
        error: Option<String>,
    ) -> Value {
        let avg = |vals: Vec<f64>| {
            if vals.is_empty() {
                0.0
            } else {
                vals.iter().copied().sum::<f64>() / vals.len() as f64
            }
        };

        let summary = json!({
            "count": samples.len(),
            "avg_utilization_pct": avg(samples.iter().map(|s| s.utilization_pct).collect()),
            "avg_mem_utilization_pct": avg(samples.iter().map(|s| s.memory_util_pct).collect()),
            "avg_temperature_c": avg(samples.iter().map(|s| s.temperature_c).collect()),
        });

        json!({
            "gpus": samples.iter().map(|s| json!({
                "index": s.index,
                "uuid": s.uuid,
                "name": s.name,
                "utilization_pct": s.utilization_pct,
                "memory_total_mb": s.memory_total_mb,
                "memory_used_mb": s.memory_used_mb,
                "memory_utilization_pct": s.memory_util_pct,
                "temperature_c": s.temperature_c,
                "fan_speed_pct": s.fan_speed_pct,
                "power_draw_w": s.power_draw_w,
                "power_limit_w": s.power_limit_w,
                "graphics_clock_mhz": s.graphics_clock_mhz,
                "sm_clock_mhz": s.sm_clock_mhz,
                "mem_clock_mhz": s.mem_clock_mhz,
                "pci_bus": s.pci_bus,
            })).collect::<Vec<_>>(),
            "summary": summary,
            "collector_disabled": collector_disabled,
            "error": error,
        })
    }

    fn collect_nvml() -> Result<Vec<GpuSample>> {
        use nvml_wrapper::enum_wrappers::device::TemperatureSensor;
        use nvml_wrapper::Nvml;

        let nvml = Nvml::init()?;
        let count = nvml.device_count()?;
        let mut out = Vec::new();

        for idx in 0..count {
            let device = nvml.device_by_index(idx)?;
            let name = device.name()?;
            let uuid = device.uuid()?;

            let util = device.utilization_rates().ok();
            let mem = device.memory_info().ok();
            let temp = device.temperature(TemperatureSensor::Gpu).ok();
            let fan = device.fan_speed(0).ok();
            let power = device.power_usage().ok();
            let power_limit = device.enforced_power_limit().ok();
            let pci_bus = device.pci_info().ok().map(|p| p.bus_id);

            let mem_total_mb = mem
                .as_ref()
                .map(|m| m.total as f64 / 1024f64 / 1024f64)
                .unwrap_or(0.0);
            let mem_used_mb = mem
                .as_ref()
                .map(|m| m.used as f64 / 1024f64 / 1024f64)
                .unwrap_or(0.0);
            let mem_util = if mem_total_mb > 0.0 {
                (mem_used_mb / mem_total_mb) * 100.0
            } else {
                0.0
            };

            out.push(GpuSample {
                index: idx,
                uuid,
                name,
                utilization_pct: util.map(|u| u.gpu as f64).unwrap_or(0.0),
                memory_total_mb: mem_total_mb,
                memory_used_mb: mem_used_mb,
                memory_util_pct: mem_util,
                temperature_c: temp.unwrap_or(0) as f64,
                fan_speed_pct: fan.map(|v| v as f64),
                power_draw_w: power.map(|v| v as f64 / 1000.0),
                power_limit_w: power_limit.map(|v| v as f64 / 1000.0),
                graphics_clock_mhz: None,
                sm_clock_mhz: None,
                mem_clock_mhz: None,
                pci_bus,
            });
        }

        Ok(out)
    }

    fn collect_nvidia_smi() -> Result<Vec<GpuSample>> {
        let fields = [
            "index",
            "uuid",
            "name",
            "utilization.gpu",
            "utilization.memory",
            "memory.total",
            "memory.used",
            "temperature.gpu",
            "fan.speed",
            "power.draw",
            "power.limit",
            "clocks.gr",
            "clocks.sm",
            "clocks.mem",
            "pci.bus_id",
        ];

        let output = Command::new("nvidia-smi")
            .args([
                "--query-gpu",
                &fields.join(","),
                "--format=csv,noheader,nounits",
            ])
            .output()
            .map_err(|e| anyhow!("nvidia-smi failed: {e}"))?;

        if !output.status.success() {
            return Err(anyhow!(
                "nvidia-smi exited with status {:?}",
                output.status.code()
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut out = Vec::new();
        for line in stdout.lines() {
            let cols: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
            if cols.len() < fields.len() {
                continue;
            }

            let idx = cols[0].parse::<u32>().unwrap_or(0);
            let uuid = cols[1].to_string();
            let name = cols[2].to_string();
            let util = cols[3].parse::<f64>().unwrap_or(0.0);
            let mem_util = cols[4].parse::<f64>().unwrap_or(0.0);
            let mem_total_mb = cols[5].parse::<f64>().unwrap_or(0.0);
            let mem_used_mb = cols[6].parse::<f64>().unwrap_or(0.0);
            let temp = cols[7].parse::<f64>().unwrap_or(0.0);
            let fan = cols[8].parse::<f64>().ok();
            let power_draw = cols[9].parse::<f64>().ok();
            let power_limit = cols[10].parse::<f64>().ok();
            let gfx_clock = cols[11].parse::<f64>().ok();
            let sm_clock = cols[12].parse::<f64>().ok();
            let mem_clock = cols[13].parse::<f64>().ok();
            let pci_bus = cols.get(14).map(|s| s.to_string());

            out.push(GpuSample {
                index: idx,
                uuid,
                name,
                utilization_pct: util,
                memory_total_mb: mem_total_mb,
                memory_used_mb: mem_used_mb,
                memory_util_pct: mem_util,
                temperature_c: temp,
                fan_speed_pct: fan,
                power_draw_w: power_draw,
                power_limit_w: power_limit,
                graphics_clock_mhz: gfx_clock,
                sm_clock_mhz: sm_clock,
                mem_clock_mhz: mem_clock,
                pci_bus,
            });
        }

        Ok(out)
    }
}

#[async_trait]
impl Collector for GpuCollector {
    fn name(&self) -> &'static str {
        "gpu"
    }

    async fn collect(&self) -> Result<Value> {
        {
            let flags = self.flags.read().await;
            if !flags.get("gpu").copied().unwrap_or(false) {
                return Ok(Self::build_payload(
                    &[],
                    true,
                    Some("collector disabled".to_string()),
                ));
            }
        }

        // Try NVML first, then fall back to nvidia-smi
        let samples = match Self::collect_nvml() {
            Ok(s) if !s.is_empty() => Ok(s),
            Ok(_) => Self::collect_nvidia_smi(),
            Err(_) => Self::collect_nvidia_smi(),
        };

        match samples {
            Ok(s) if !s.is_empty() => Ok(Self::build_payload(&s, false, None)),
            Ok(_) => Ok(Self::build_payload(
                &[],
                true,
                Some("no GPUs detected".to_string()),
            )),
            Err(e) => Ok(Self::build_payload(&[], true, Some(e.to_string()))),
        }
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_payload_summarises() {
        let samples = vec![GpuSample {
            index: 0,
            uuid: "GPU-123".into(),
            name: "Test GPU".into(),
            utilization_pct: 50.0,
            memory_total_mb: 1000.0,
            memory_used_mb: 500.0,
            memory_util_pct: 50.0,
            temperature_c: 60.0,
            fan_speed_pct: Some(30.0),
            power_draw_w: Some(100.0),
            power_limit_w: Some(150.0),
            graphics_clock_mhz: Some(1200.0),
            sm_clock_mhz: Some(1100.0),
            mem_clock_mhz: Some(5000.0),
            pci_bus: Some("0000:01:00.0".into()),
        }];

        let payload = GpuCollector::build_payload(&samples, false, None);
        assert_eq!(payload["gpus"].as_array().unwrap().len(), 1);
        assert_eq!(payload["summary"]["count"].as_u64().unwrap(), 1);
        assert_eq!(
            payload["summary"]["avg_utilization_pct"].as_f64().unwrap(),
            50.0
        );
        assert_eq!(payload["collector_disabled"].as_bool().unwrap(), false);
    }
}
