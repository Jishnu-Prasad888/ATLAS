import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  Button,
  Input,
  Select,
  Spinner,
  Card,
  StatusBadge,
  AgentStatusBadge,
  CollectorStatusBadge,
  SeverityBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  GaugeBar,
  Toggle,
  ConfirmDialog,
  Tag,
  KvRow,
} from '@/components/common'

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('calls onClick handler', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Click</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is disabled when loading', () => {
    render(<Button loading>Save</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('is disabled when disabled prop is set', () => {
    render(<Button disabled>Save</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('shows spinner when loading', () => {
    const { container } = render(<Button loading>Save</Button>)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('applies variant classes', () => {
    const { rerender } = render(<Button variant="primary">Primary</Button>)
    expect(screen.getByRole('button').className).toContain('bg-blue-600')

    rerender(<Button variant="danger">Danger</Button>)
    expect(screen.getByRole('button').className).toContain('text-red-400')
  })
})

describe('Input', () => {
  it('renders with label', () => {
    render(<Input label="Username" />)
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
  })

  it('shows error message', () => {
    render(<Input label="Password" error="Too short" />)
    expect(screen.getByText('Too short')).toBeInTheDocument()
  })

  it('shows hint when no error', () => {
    render(<Input label="Password" hint="Min 12 chars" />)
    expect(screen.getByText('Min 12 chars')).toBeInTheDocument()
  })

  it('does not show hint when error is present', () => {
    render(<Input label="Password" hint="Min 12 chars" error="Too short" />)
    expect(screen.queryByText('Min 12 chars')).not.toBeInTheDocument()
    expect(screen.getByText('Too short')).toBeInTheDocument()
  })

  it('fires onChange', () => {
    const onChange = vi.fn()
    render(<Input label="Search" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'test' } })
    expect(onChange).toHaveBeenCalled()
  })
})

describe('Select', () => {
  it('renders with label', () => {
    render(
      <Select label="Role">
        <option value="viewer">viewer</option>
      </Select>
    )
    expect(screen.getByLabelText('Role')).toBeInTheDocument()
  })

  it('shows error', () => {
    render(
      <Select label="Role" error="Invalid role">
        <option value="viewer">viewer</option>
      </Select>
    )
    expect(screen.getByText('Invalid role')).toBeInTheDocument()
  })
})

describe('Spinner', () => {
  it('renders spinning element', () => {
    const { container } = render(<Spinner />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })
})

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>)
    expect(screen.getByText('Card content')).toBeInTheDocument()
  })

  it('applies padding by default', () => {
    const { container } = render(<Card>Content</Card>)
    expect(container.firstChild).toHaveClass('p-4')
  })

  it('removes padding when padding=false', () => {
    const { container } = render(<Card padding={false}>Content</Card>)
    expect(container.firstChild).not.toHaveClass('p-4')
  })
})

describe('StatusBadge', () => {
  it('renders status text', () => {
    render(<StatusBadge status="ONLINE" variant="online" />)
    expect(screen.getByText('ONLINE')).toBeInTheDocument()
  })
})

describe('AgentStatusBadge', () => {
  it('renders ONLINE status', () => {
    render(<AgentStatusBadge status="ONLINE" />)
    expect(screen.getByText('ONLINE')).toBeInTheDocument()
  })

  it('renders DEGRADED status', () => {
    render(<AgentStatusBadge status="DEGRADED" />)
    expect(screen.getByText('DEGRADED')).toBeInTheDocument()
  })

  it('renders OFFLINE status', () => {
    render(<AgentStatusBadge status="OFFLINE" />)
    expect(screen.getByText('OFFLINE')).toBeInTheDocument()
  })
})

describe('CollectorStatusBadge', () => {
  it('renders Healthy status', () => {
    render(<CollectorStatusBadge status="Healthy" />)
    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })
})

describe('SeverityBadge', () => {
  it('renders severity label', () => {
    render(<SeverityBadge severity="Error" />)
    expect(screen.getByText(/ERROR/)).toBeInTheDocument()
  })

  it('renders all severities', () => {
    const severities = ['Trace', 'Debug', 'Info', 'Warning', 'Error', 'Critical'] as const
    severities.forEach((s) => {
      const { unmount } = render(<SeverityBadge severity={s} />)
      expect(screen.getByText(new RegExp(s.toUpperCase()))).toBeInTheDocument()
      unmount()
    })
  })
})

describe('EmptyState', () => {
  it('renders message', () => {
    render(<EmptyState message="No data found" />)
    expect(screen.getByText('No data found')).toBeInTheDocument()
  })

  it('renders detail when provided', () => {
    render(<EmptyState message="No data" detail="Try adjusting filters" />)
    expect(screen.getByText('Try adjusting filters')).toBeInTheDocument()
  })
})

describe('ErrorState', () => {
  it('renders error message', () => {
    render(<ErrorState error="Failed to load" />)
    expect(screen.getByText('Failed to load')).toBeInTheDocument()
  })

  it('renders retry button when provided', () => {
    const onRetry = vi.fn()
    render(<ErrorState error="Failed" onRetry={onRetry} />)
    fireEvent.click(screen.getByText('Retry'))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('does not render retry button when not provided', () => {
    render(<ErrorState error="Failed" />)
    expect(screen.queryByText('Retry')).not.toBeInTheDocument()
  })
})

describe('LoadingState', () => {
  it('renders default label', () => {
    render(<LoadingState />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders custom label', () => {
    render(<LoadingState label="Fetching agents..." />)
    expect(screen.getByText('Fetching agents...')).toBeInTheDocument()
  })
})

describe('GaugeBar', () => {
  it('renders label and value', () => {
    render(<GaugeBar label="CPU" value={42.5} />)
    expect(screen.getByText('CPU')).toBeInTheDocument()
    expect(screen.getByText('42.5%')).toBeInTheDocument()
  })

  it('clamps value to 100', () => {
    const { container } = render(<GaugeBar label="Test" value={150} />)
    const bar = container.querySelector('[style]') as HTMLElement
    expect(bar.style.width).toBe('100%')
  })

  it('renders detail text', () => {
    render(<GaugeBar label="CPU" value={50} detail="4 / 8 GB" />)
    expect(screen.getByText('4 / 8 GB')).toBeInTheDocument()
  })

  it('uses green color below warn threshold', () => {
    const { container } = render(<GaugeBar label="CPU" value={50} />)
    const bar = container.querySelector('.bg-green-500')
    expect(bar).toBeInTheDocument()
  })

  it('uses yellow color at warn threshold', () => {
    const { container } = render(<GaugeBar label="CPU" value={75} />)
    const bar = container.querySelector('.bg-yellow-400')
    expect(bar).toBeInTheDocument()
  })

  it('uses red color at danger threshold', () => {
    const { container } = render(<GaugeBar label="CPU" value={92} />)
    const bar = container.querySelector('.bg-red-500')
    expect(bar).toBeInTheDocument()
  })
})

describe('Toggle', () => {
  it('renders as switch', () => {
    render(<Toggle checked={false} onChange={() => {}} />)
    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('reflects checked state', () => {
    render(<Toggle checked={true} onChange={() => {}} />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('calls onChange when clicked', () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('is disabled when disabled prop is set', () => {
    render(<Toggle checked={false} onChange={() => {}} disabled />)
    expect(screen.getByRole('switch')).toBeDisabled()
  })
})

describe('ConfirmDialog', () => {
  it('renders title and message', () => {
    render(
      <ConfirmDialog
        title="Delete agent"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    expect(screen.getByText('Delete agent')).toBeInTheDocument()
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()
  })

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        title="Delete"
        message="Sure?"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="Delete"
        message="Sure?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('renders custom confirm label', () => {
    render(
      <ConfirmDialog
        title="Delete"
        message="Sure?"
        confirmLabel="Remove"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    expect(screen.getByText('Remove')).toBeInTheDocument()
  })
})

describe('Tag', () => {
  it('renders content', () => {
    render(<Tag>production</Tag>)
    expect(screen.getByText('production')).toBeInTheDocument()
  })
})

describe('KvRow', () => {
  it('renders label and value', () => {
    render(<KvRow label="OS" value="linux" />)
    expect(screen.getByText('OS')).toBeInTheDocument()
    expect(screen.getByText('linux')).toBeInTheDocument()
  })
})
