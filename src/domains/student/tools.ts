/**
 * MCP tool definitions for student operations.
 *
 * Defines the schemas and metadata for student-related MCP tools
 * such as searching persons, students, courses, and sections.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../middleware/error-handler.js';
import * as handlers from './handlers.js';

/**
 * Registers all student-related tools with the MCP server.
 * Tools follow the `banner_*` naming convention.
 */
export function registerStudentTools(server: McpServer): void {
  server.registerTool(
    'banner_persons_search',
    {
      title: 'Search Persons',
      description:
        'Search for persons in Banner via Ethos. Returns paginated results with biographical data.',
      inputSchema: {
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const page = await handlers.searchPersons(args.offset, args.limit);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  totalCount: page.totalCount,
                  offset: page.offset,
                  hasMore: page.hasMore,
                  count: page.data.length,
                  data: page.data,
                },
                null,
                2,
              ),
            },
          ],
        };
      });
    },
  );

  server.registerTool(
    'banner_persons_get',
    {
      title: 'Get Person',
      description: 'Get a single person by GUID from Banner via Ethos.',
      inputSchema: {
        id: z.string().describe('Person GUID'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const person = await handlers.getPerson(args.id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(person, null, 2) }],
        };
      });
    },
  );

  server.registerTool(
    'banner_students_search',
    {
      title: 'Search Students',
      description: 'Search for students in Banner via Ethos. Returns paginated results.',
      inputSchema: {
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const page = await handlers.searchStudents(args.offset, args.limit);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  totalCount: page.totalCount,
                  offset: page.offset,
                  hasMore: page.hasMore,
                  count: page.data.length,
                  data: page.data,
                },
                null,
                2,
              ),
            },
          ],
        };
      });
    },
  );

  server.registerTool(
    'banner_students_get',
    {
      title: 'Get Student',
      description: 'Get a single student by GUID from Banner via Ethos.',
      inputSchema: {
        id: z.string().describe('Student GUID'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const student = await handlers.getStudent(args.id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(student, null, 2) }],
        };
      });
    },
  );

  server.registerTool(
    'banner_courses_get',
    {
      title: 'Get Course',
      description: 'Get a single course by GUID from the Banner catalog via Ethos.',
      inputSchema: {
        id: z.string().describe('Course GUID'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const course = await handlers.getCourse(args.id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(course, null, 2) }],
        };
      });
    },
  );

  server.registerTool(
    'banner_sections_search',
    {
      title: 'Search Sections',
      description: 'Search for course sections in Banner via Ethos. Returns paginated results.',
      inputSchema: {
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const page = await handlers.searchSections(args.offset, args.limit);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  totalCount: page.totalCount,
                  offset: page.offset,
                  hasMore: page.hasMore,
                  count: page.data.length,
                  data: page.data,
                },
                null,
                2,
              ),
            },
          ],
        };
      });
    },
  );

  server.registerTool(
    'banner_academic_periods_get',
    {
      title: 'Get Academic Periods',
      description:
        'Get academic periods (terms/semesters) from Banner via Ethos. Returns paginated results.',
      inputSchema: {
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const page = await handlers.getAcademicPeriods(args.offset, args.limit);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  totalCount: page.totalCount,
                  offset: page.offset,
                  hasMore: page.hasMore,
                  count: page.data.length,
                  data: page.data,
                },
                null,
                2,
              ),
            },
          ],
        };
      });
    },
  );
}
