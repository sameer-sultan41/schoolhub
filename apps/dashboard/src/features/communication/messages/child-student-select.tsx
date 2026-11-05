"use client";

import { useTranslations } from "next-intl";
import {
  FormControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";

import type { PickedStudent } from "./student-picker";

export interface ChildStudentSelectProps {
  /** The only students that can be picked (the guardian's own children). */
  students: readonly PickedStudent[];
  value: PickedStudent | null;
  onChange: (value: PickedStudent | null) => void;
}

/** The student a portal thread is about, picked from a fixed list rather than searched. */
export function ChildStudentSelect({ students, value, onChange }: ChildStudentSelectProps) {
  const t = useTranslations("communication.messages.picker");

  return (
    <Select
      value={value?.id ?? ""}
      onValueChange={(id) => {
        onChange(students.find((student) => student.id === id) ?? null);
      }}
    >
      <FormControl>
        <SelectTrigger>
          <SelectValue placeholder={t("chooseStudent")} />
        </SelectTrigger>
      </FormControl>
      <SelectContent>
        {students.map((student) => (
          <SelectItem key={student.id} value={student.id}>
            {student.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
