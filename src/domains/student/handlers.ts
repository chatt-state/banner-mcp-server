/**
 * Handler implementations for student MCP tools.
 *
 * Contains the business logic that executes when student-related
 * MCP tools are invoked by the client. Each handler calls the
 * Ethos API via the shared EthosClient's typed resource accessors.
 */

import { getEthosClient } from '../../banner-client.js';

/** Fetches a page of persons from Ethos. */
export async function searchPersons(offset = 0, limit = 25) {
  return getEthosClient().persons.getPage(offset, limit);
}

/** Fetches a single person by GUID. */
export async function getPerson(id: string) {
  return getEthosClient().persons.get(id);
}

/** Fetches a page of students from Ethos. */
export async function searchStudents(offset = 0, limit = 25) {
  return getEthosClient().students.getPage(offset, limit);
}

/** Fetches a single student by GUID. */
export async function getStudent(id: string) {
  return getEthosClient().students.get(id);
}

/** Fetches a single course by GUID. */
export async function getCourse(id: string) {
  return getEthosClient().courses.get(id);
}

/** Fetches a page of sections from Ethos. */
export async function searchSections(offset = 0, limit = 25) {
  return getEthosClient().sections.getPage(offset, limit);
}

/** Fetches a page of academic periods from Ethos. */
export async function getAcademicPeriods(offset = 0, limit = 25) {
  return getEthosClient().academicPeriods.getPage(offset, limit);
}
