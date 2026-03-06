/**
 * Handler implementations for student MCP tools.
 *
 * Contains the business logic that executes when student-related
 * MCP tools are invoked by the client. Each handler calls the
 * Ethos API via the shared EthosClient.
 */

import { getEthosClient } from '../../banner-client.js';

/** Fetches a page of persons from Ethos. */
export async function searchPersons(offset = 0, limit = 25, version = 12) {
  return getEthosClient().getPage('persons', offset, limit, version);
}

/** Fetches a single person by GUID. */
export async function getPerson(id: string, version = 12) {
  return getEthosClient().get('persons', id, version);
}

/** Fetches a page of students from Ethos. */
export async function searchStudents(offset = 0, limit = 25, version = 16) {
  return getEthosClient().getPage('students', offset, limit, version);
}

/** Fetches a single student by GUID. */
export async function getStudent(id: string, version = 16) {
  return getEthosClient().get('students', id, version);
}

/** Fetches a single course by GUID. */
export async function getCourse(id: string, version = 4) {
  return getEthosClient().get('courses', id, version);
}

/** Fetches a page of sections from Ethos. */
export async function searchSections(offset = 0, limit = 25, version = 16) {
  return getEthosClient().getPage('sections', offset, limit, version);
}

/** Fetches a page of academic periods from Ethos. */
export async function getAcademicPeriods(offset = 0, limit = 25, version = 16) {
  return getEthosClient().getPage('academic-periods', offset, limit, version);
}
