import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). */
export type RoomRecord = ApiSchemas["Room"];
export type RoomType = ApiSchemas["RoomTypeEnum"];

export interface RoomPageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
  campusId?: string;
  roomType?: RoomType;
  isActive?: boolean;
}

/** A null `capacity` is "no fixed seating"; a null building or floor clears it. */
export interface RoomInput {
  campusId: string;
  name: string;
  code: string;
  roomType: RoomType;
  capacity: number | null;
  building: string | null;
  floor: string | null;
  isActive: boolean;
}
