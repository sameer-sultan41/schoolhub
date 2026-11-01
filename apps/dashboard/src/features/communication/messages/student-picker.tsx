"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@schoolhub/ui";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { MESSAGE_THREADS_QUERY_MODULE } from "@/services/modules/message-threads/message-threads-constant";

import { PickerPopover } from "./picker-popover";

/** The student a guardian thread is about; `name` is kept for the chip, `id` is what is sent. */
export interface PickedStudent {
  id: string;
  name: string;
}

export interface StudentPickerProps {
  value: PickedStudent | null;
  onChange: (value: PickedStudent | null) => void;
}

const RESULTS_PAGE_SIZE = 10;

/** One student, searched through the students list (`?search=`), for a guardian thread. */
export function StudentPicker({ value, onChange }: StudentPickerProps) {
  const t = useTranslations("communication.messages.picker");
  const tErrors = useTranslations("errors");
  const [input, setInput] = useState("");
  const search = useDebouncedValue(input.trim(), SEARCH_DEBOUNCE_MS);

  const students = useQuery({
    queryKey: queryKeys.list(MESSAGE_THREADS_QUERY_MODULE, "student-search", { search }),
    queryFn: () =>
      Services.students.fetchStudentsPage({ page: 1, pageSize: RESULTS_PAGE_SIZE, search }),
  });

  const options = (students.data?.items ?? []).map((student) => ({
    id: student.id,
    label: `${student.first_name} ${student.last_name}`,
    hint: student.admission_number,
  }));

  function pick(studentId: string) {
    const option = options.find((candidate) => candidate.id === studentId);
    if (option) onChange({ id: option.id, name: option.label });
  }

  return (
    <PickerPopover
      triggerLabel={t("chooseStudent")}
      searchLabel={t("searchStudents")}
      search={input}
      onSearchChange={setInput}
      options={options}
      isLoading={students.isPending}
      error={students.isError ? resolveErrorMessage(students.error, tErrors, t("failed")) : null}
      onPick={pick}
      closeOnPick
    >
      {value && (
        <Badge variant="secondary" appearance="light" size="lg" className="w-fit">
          {value.name}
          <Button
            type="button"
            variant="ghost"
            mode="icon"
            size="sm"
            className="size-4"
            aria-label={t("remove", { name: value.name })}
            onClick={() => {
              onChange(null);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </Badge>
      )}
    </PickerPopover>
  );
}
