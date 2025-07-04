import { createMocks } from 'node-mocks-http';
import loginHandler from '../../../pages/api/auth/login';
import refreshHandler from '../../../pages/api/auth/refresh';
import meHandler from '../../../pages/api/auth/me';
import { NextApiRequest } from 'next';
import { prisma } from '../../../lib/database/client';
import { createTestSuite, createTestUser, cleanupTestUser, createAuthenticatedRequest, createUnauthenticatedRequest } from '../../helpers/testUtils';
import { Role } from '../../../src/generated/prisma';

describe('Authentication Integration Tests', () => {
  const testSuite = createTestSuite('Authentication Tests');
  let testUsers: any[] = [];

  beforeAll(async () => {
    await testSuite.beforeAll();
    // testUsers creation moved to beforeEach
  });

  afterAll(async () => {
    await testSuite.afterAll();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await prisma.endpoint.deleteMany({
      where: {
        apiConnection: {
          user: {
            OR: [
              { email: { contains: 'test-' } },
              { email: { contains: '@example.com' } }
            ]
          }
        }
      }
    });
    await prisma.apiConnection.deleteMany({
      where: {
        user: {
          OR: [
            { email: { contains: 'test-' } },
            { email: { contains: '@example.com' } }
          ]
        }
      }
    });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { contains: 'test-' } },
          { email: { contains: '@example.com' } }
        ]
      }
    });
    // Always create testUsers after cleanup
    testUsers = [];
    const users = [
      { email: 'testuser@example.com', password: 'user123', role: Role.USER },
      { email: 'testadmin@example.com', password: 'admin123', role: Role.ADMIN },
      { email: 'testsuper@example.com', password: 'super123', role: Role.SUPER_ADMIN }
    ];
    for (const userData of users) {
      const user = await testSuite.createUser(
        userData.email,
        userData.password,
        userData.role,
        `Test ${userData.role}`
      );
      testUsers.push(user);
    }
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const adminUser = testUsers.find(u => u.role === Role.ADMIN);
      const { req, res } = createUnauthenticatedRequest('POST', {
        body: {
          email: adminUser.email,
          password: adminUser.password
        }
      });

      await loginHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.data.user.email).toBe(adminUser.email);
      expect(data.data.user.role).toBe(Role.ADMIN);
      expect(data.data.accessToken).toBeDefined();
      expect(data.data.refreshToken).toBeDefined();
    });

    it('should reject invalid credentials', async () => {
      const { req, res } = createUnauthenticatedRequest('POST', {
        body: {
          email: 'invalid@example.com',
          password: 'wrongpassword'
        }
      });

      await loginHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(401);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid credentials');
      expect(data.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject missing credentials', async () => {
      const { req, res } = createUnauthenticatedRequest('POST', {
        body: {
          email: 'testadmin@example.com'
          // missing password
        }
      });

      await loginHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
      expect(data.error).toBe('Email and password are required');
    });

    it('should reject wrong HTTP method', async () => {
      const { req, res } = createUnauthenticatedRequest('GET');

      await loginHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(405);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
      expect(data.error).toBe('Method not allowed');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh token with valid refresh token', async () => {
      const adminUser = testUsers.find(u => u.role === Role.ADMIN);
      const { req, res } = createUnauthenticatedRequest('POST', {
        body: {
          refreshToken: adminUser.refreshToken
        }
      });

      await refreshHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.data.accessToken).toBeDefined();
      // Note: The new access token may be the same if the original hasn't expired yet
      // This is acceptable behavior for token refresh
    });

    it('should reject invalid refresh token', async () => {
      const { req, res } = createUnauthenticatedRequest('POST', {
        body: {
          refreshToken: 'invalid-token'
        }
      });

      await refreshHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(401);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid or expired token');
    });

    it('should reject missing refresh token', async () => {
      const { req, res } = createUnauthenticatedRequest('POST', {
        body: {}
      });

      await refreshHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
      expect(data.error).toBe('Refresh token is required');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user with valid token', async () => {
      const adminUser = testUsers.find(u => u.role === Role.ADMIN);
      const { req, res } = createAuthenticatedRequest('GET', adminUser);

      await meHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.data.user.email).toBe(adminUser.email);
      expect(data.data.user.role).toBe(Role.ADMIN);
    });

    it('should reject request without token', async () => {
      const { req, res } = createUnauthenticatedRequest('GET');

      await meHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(401);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
      expect(data.error).toBe('Authentication required');
    });

    it('should reject invalid token', async () => {
      const { req, res } = createUnauthenticatedRequest('GET', {
        headers: {
          authorization: 'Bearer invalid-token'
        }
      });

      await meHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(401);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid or expired token');
    });

    it('should reject wrong HTTP method', async () => {
      const { req, res } = createUnauthenticatedRequest('POST');

      await meHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(405);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
      expect(data.error).toBe('Method not allowed');
    });
  });

  describe('User Roles', () => {
    it('should support different user roles', async () => {
      for (const user of testUsers) {
        const { req, res } = createUnauthenticatedRequest('POST', {
          body: {
            email: user.email,
            password: user.password
          }
        });

        await loginHandler(req as any, res as any);

        expect(res._getStatusCode()).toBe(200);
        const data = JSON.parse(res._getData());
        expect(data.success).toBe(true);
        expect(data.data.user.role).toBe(user.role);
        expect(data.data.accessToken).toBeDefined();
        expect(data.data.refreshToken).toBeDefined();
      }
    });
  });
}); 