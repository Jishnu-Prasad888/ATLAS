import { request } from './client'
import type { User, Role } from '@/types'

export const usersApi = {
  list: () =>
    request<User[]>({ method: 'GET', url: '/users/' }),

  get: (id: number) =>
    request<User>({ method: 'GET', url: `/users/${id}/` }),

  create: (data: { username: string; email?: string; password: string; role: Role }) =>
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
}
