import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getLocations, POST as createLocation } from '@/app/api/v1/locations/route';
import { PATCH as updateLocation, DELETE as deleteLocation } from '@/app/api/v1/locations/[id]/route';
import prisma from '@/src/db';
import * as authModule from '@/src/auth';

vi.mock('@/src/auth', () => ({
  requireAuth: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock('@/src/db', () => ({
  default: {
    organization: {
      findUnique: vi.fn(),
    },
    membership: {
      findUnique: vi.fn(),
    },
    campusLocation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
  },
}));

describe('Campus Locations Management API (Admin Controls)', () => {
  const dummyAdminId = 'a0000000-0000-4000-8000-000000000001';
  const dummyStudentId = 'a0000000-0000-4000-8000-000000000002';
  const dummyOrgId = 'a0000000-0000-4000-8000-000000000003';
  const dummyLocationId = 'a0000000-0000-4000-8000-000000000004';

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: dummyOrgId,
      name: 'CMR Institute of Technology',
      slug: 'cmrit-lost-and-found',
      verifiedEmailDomain: 'cmrit.ac.in',
      createdAt: new Date(),
    } as any);
  });

  describe('GET /api/v1/locations', () => {
    it('returns active campus locations for an organization', async () => {
      vi.mocked(prisma.campusLocation.findMany).mockResolvedValue([
        {
          id: dummyLocationId,
          organizationId: dummyOrgId,
          name: 'Central Library & Reading Hall',
          area: 'Central',
          isActive: true,
          sortOrder: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const req = new NextRequest(`http://localhost:3000/api/v1/locations?orgId=${dummyOrgId}`);
      const res = await getLocations(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Central Library & Reading Hall');
    });

    it('returns seeded defaults if database locations are initially empty', async () => {
      vi.mocked(prisma.campusLocation.findMany)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: dummyLocationId,
            organizationId: dummyOrgId,
            name: 'Central Library & Reading Hall',
            area: 'Central',
            isActive: true,
            sortOrder: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);

      const req = new NextRequest(`http://localhost:3000/api/v1/locations?orgId=${dummyOrgId}`);
      const res = await getLocations(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(prisma.campusLocation.createMany).toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/locations (Admin Only)', () => {
    it('rejects regular member with 403 FORBIDDEN when attempting to add location', async () => {
      vi.mocked(authModule.requireAuth).mockResolvedValue({
        id: dummyStudentId,
        email: 'student@cmrit.ac.in',
        displayName: 'Student User',
      } as any);

      vi.mocked(prisma.membership.findUnique).mockResolvedValue({
        organizationId: dummyOrgId,
        userId: dummyStudentId,
        role: 'MEMBER',
        joinedAt: new Date(),
      });

      const req = new NextRequest('http://localhost:3000/api/v1/locations', {
        method: 'POST',
        body: JSON.stringify({
          orgId: dummyOrgId,
          name: 'Architecture Studio 4',
        }),
      });

      const res = await createLocation(req);
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.error?.code).toBe('FORBIDDEN');
      expect(body.error?.message).toContain('Only campus administrators can add campus locations');
    });

    it('rejects invalid payload with 400 VALIDATION_ERROR', async () => {
      vi.mocked(authModule.requireAuth).mockResolvedValue({
        id: dummyAdminId,
        email: 'admin@cmrit.ac.in',
        displayName: 'Admin User',
      } as any);

      const req = new NextRequest('http://localhost:3000/api/v1/locations', {
        method: 'POST',
        body: JSON.stringify({
          orgId: 'not-a-uuid',
          name: 'A', // Too short
        }),
      });

      const res = await createLocation(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('allows ORG_ADMIN to create campus location and logs immutable audit event', async () => {
      vi.mocked(authModule.requireAuth).mockResolvedValue({
        id: dummyAdminId,
        email: 'admin@cmrit.ac.in',
        displayName: 'Admin User',
      } as any);

      vi.mocked(prisma.membership.findUnique).mockResolvedValue({
        organizationId: dummyOrgId,
        userId: dummyAdminId,
        role: 'ORG_ADMIN',
        joinedAt: new Date(),
      });

      vi.mocked(prisma.campusLocation.create).mockResolvedValue({
        id: dummyLocationId,
        organizationId: dummyOrgId,
        name: 'Architecture Studio 4',
        area: 'Architecture',
        isActive: true,
        sortOrder: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new NextRequest('http://localhost:3000/api/v1/locations', {
        method: 'POST',
        body: JSON.stringify({
          orgId: dummyOrgId,
          name: 'Architecture Studio 4',
          area: 'Architecture',
          sortOrder: 10,
        }),
      });

      const res = await createLocation(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.data?.name).toBe('Architecture Studio 4');
      expect(prisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CAMPUS_LOCATION_CREATED',
            entityType: 'CAMPUS_LOCATION',
          }),
        })
      );
    });
  });

  describe('PATCH /api/v1/locations/[id] (Admin Only)', () => {
    it('rejects non-admin user with 403 FORBIDDEN when modifying location', async () => {
      vi.mocked(authModule.requireAuth).mockResolvedValue({
        id: dummyStudentId,
        email: 'student@cmrit.ac.in',
        displayName: 'Student User',
      } as any);

      vi.mocked(prisma.campusLocation.findUnique).mockResolvedValue({
        id: dummyLocationId,
        organizationId: dummyOrgId,
        name: 'Old Name',
        area: 'Old Area',
        isActive: true,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.membership.findUnique).mockResolvedValue({
        organizationId: dummyOrgId,
        userId: dummyStudentId,
        role: 'MEMBER',
        joinedAt: new Date(),
      });

      const req = new NextRequest(`http://localhost:3000/api/v1/locations/${dummyLocationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New Name' }),
      });

      const res = await updateLocation(req, { params: Promise.resolve({ id: dummyLocationId }) });
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.error?.code).toBe('FORBIDDEN');
    });

    it('allows ORG_ADMIN to modify location details and records audit event', async () => {
      vi.mocked(authModule.requireAuth).mockResolvedValue({
        id: dummyAdminId,
        email: 'admin@cmrit.ac.in',
        displayName: 'Admin User',
      } as any);

      vi.mocked(prisma.campusLocation.findUnique).mockResolvedValue({
        id: dummyLocationId,
        organizationId: dummyOrgId,
        name: 'Old Name',
        area: 'Old Area',
        isActive: true,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.membership.findUnique).mockResolvedValue({
        organizationId: dummyOrgId,
        userId: dummyAdminId,
        role: 'ORG_ADMIN',
        joinedAt: new Date(),
      });

      vi.mocked(prisma.campusLocation.update).mockResolvedValue({
        id: dummyLocationId,
        organizationId: dummyOrgId,
        name: 'Updated Name',
        area: 'Updated Area',
        isActive: false,
        sortOrder: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new NextRequest(`http://localhost:3000/api/v1/locations/${dummyLocationId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Updated Name',
          isActive: false,
        }),
      });

      const res = await updateLocation(req, { params: Promise.resolve({ id: dummyLocationId }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data?.name).toBe('Updated Name');
      expect(prisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CAMPUS_LOCATION_UPDATED',
          }),
        })
      );
    });
  });

  describe('DELETE /api/v1/locations/[id] (Admin Only)', () => {
    it('allows ORG_ADMIN to delete a campus location and records audit event', async () => {
      vi.mocked(authModule.requireAuth).mockResolvedValue({
        id: dummyAdminId,
        email: 'admin@cmrit.ac.in',
        displayName: 'Admin User',
      } as any);

      vi.mocked(prisma.campusLocation.findUnique).mockResolvedValue({
        id: dummyLocationId,
        organizationId: dummyOrgId,
        name: 'Obsolete Building',
        area: 'Old',
        isActive: false,
        sortOrder: 99,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.membership.findUnique).mockResolvedValue({
        organizationId: dummyOrgId,
        userId: dummyAdminId,
        role: 'ORG_ADMIN',
        joinedAt: new Date(),
      });

      const req = new NextRequest(`http://localhost:3000/api/v1/locations/${dummyLocationId}`, {
        method: 'DELETE',
      });

      const res = await deleteLocation(req, { params: Promise.resolve({ id: dummyLocationId }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data?.deleted).toBe(true);
      expect(prisma.campusLocation.delete).toHaveBeenCalledWith({
        where: { id: dummyLocationId },
      });
      expect(prisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CAMPUS_LOCATION_DELETED',
          }),
        })
      );
    });
  });
});
