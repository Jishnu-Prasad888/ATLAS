import { request } from './client'
import type { User, Role, RegistrationRequest, Organization } from '@/types'

export const usersApi = {
  list: () =>
    request<User[]>({ method: 'GET', url: '/users/' }),

  get: (id: number) =>
    request<User>({ method: 'GET', url: `/users/${id}/` }),

  create: (data: { username: string; email?: string; password: string; role: Role; access_all_agents?: boolean; agent_ids?: string[]; organization_ids?: number[]; approval_status?: 'approved' | 'pending' | 'rejected'; start_at?: string | null; expires_at?: string | null }) =>
    request<User>({ method: 'POST', url: '/users/', data }),

  update: (id: number, data: Partial<Pick<User, 'email' | 'is_active'>>) =>
    request<User>({ method: 'PATCH', url: `/users/${id}/`, data }),

  delete: (id: number) =>
    request<void>({ method: 'DELETE', url: `/users/${id}/` }),

  assignRole: (id: number, role: Role) =>
    request<User>({ method: 'POST', url: `/users/${id}/role/`, data: { role } }),

  enable: (id: number) =>
    request<User>({ method: 'POST', url: `/users/${id}/enable/`, data: {} }),

  disable: (id: number) =>
    request<User>({ method: 'POST', url: `/users/${id}/disable/`, data: {} }),

  registrations: () =>
    request<RegistrationRequest[]>({ method: 'GET', url: '/users/registrations/' }),

  decideRegistration: (id: number, payload: { action: 'approve' | 'reject'; role?: Role; access_all_agents?: boolean; agent_ids?: string[]; organization_ids?: number[]; start_at?: string | null; expires_at?: string | null }) =>
    request<User | { detail: string }>({ method: 'POST', url: `/users/registrations/${id}/decision/`, data: payload }),

  organizations: () =>
    request<Organization[]>({ method: 'GET', url: '/users/organizations/' }),

  createOrganization: (data: { name: string; description?: string; agent_ids?: string[] }) =>
    request<Organization>({ method: 'POST', url: '/users/organizations/', data }),

  updateOrganization: (id: number, data: { name?: string; description?: string; agent_ids?: string[] }) =>
    request<Organization>({ method: 'PATCH', url: `/users/organizations/${id}/`, data }),

  deleteOrganization: (id: number) =>
    request<void>({ method: 'DELETE', url: `/users/organizations/${id}/` }),
}
