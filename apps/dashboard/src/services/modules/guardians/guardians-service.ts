import { fetchPage } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { GUARDIAN_LINKS_PAGE_SIZE, GUARDIAN_SEARCH_PAGE_SIZE } from "./guardians-constant";
import {
  toCreateGuardianBody,
  toLinkGuardianBody,
  toUpdateGuardianBody,
  toUpdateGuardianLinkBody,
} from "./guardians-helper";
import type {
  CreateGuardianInput,
  GuardianLinkRecord,
  GuardianRecord,
  LinkGuardianInput,
  UpdateGuardianInput,
  UpdateGuardianLinkInput,
} from "./guardians-type";

export type {
  CreateGuardianInput,
  GuardianLinkRecord,
  GuardianRecord,
  GuardianRelationship,
  LinkGuardianInput,
  UpdateGuardianInput,
  UpdateGuardianLinkInput,
} from "./guardians-type";

export async function searchGuardians(search: string): Promise<GuardianRecord[]> {
  const { items } = await fetchPage<GuardianRecord>(apiClient, endpoints.guardians.list, {
    query: { search, page_size: GUARDIAN_SEARCH_PAGE_SIZE },
  });
  return items;
}

export async function fetchGuardianById(id: string): Promise<GuardianRecord> {
  const { data } = await apiClient.get<GuardianRecord>(endpoints.guardians.detail(id));
  return data;
}

export async function createGuardian(input: CreateGuardianInput): Promise<GuardianRecord> {
  const { data } = await apiClient.post<GuardianRecord>(
    endpoints.guardians.list,
    toCreateGuardianBody(input),
  );
  return data;
}

export async function updateGuardian(
  id: string,
  input: UpdateGuardianInput,
): Promise<GuardianRecord> {
  const { data } = await apiClient.patch<GuardianRecord>(
    endpoints.guardians.detail(id),
    toUpdateGuardianBody(input),
  );
  return data;
}

export async function linkGuardianToStudent(
  studentId: string,
  input: LinkGuardianInput,
): Promise<GuardianLinkRecord> {
  const { data } = await apiClient.post<GuardianLinkRecord>(
    endpoints.guardians.studentLinks(studentId),
    toLinkGuardianBody(input),
  );
  return data;
}

export async function updateGuardianLink(
  linkId: string,
  input: UpdateGuardianLinkInput,
): Promise<GuardianLinkRecord> {
  const { data } = await apiClient.patch<GuardianLinkRecord>(
    endpoints.studentGuardians.detail(linkId),
    toUpdateGuardianLinkBody(input),
  );
  return data;
}

export async function fetchGuardianLinks(studentId: string): Promise<GuardianLinkRecord[]> {
  const { items } = await fetchPage<GuardianLinkRecord>(
    apiClient,
    endpoints.guardians.studentLinks(studentId),
    { query: { page_size: GUARDIAN_LINKS_PAGE_SIZE } },
  );
  return items;
}
