"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { FILTER_ALL } from "@/lib/constants";
import {
  APPROVAL_FILTERS,
  QUESTION_DIFFICULTIES,
  QUESTION_SOURCES,
  QUESTION_TYPES,
  TOPIC_MAX,
} from "@/services/modules/question-banks/question-banks-constant";

/** The URL filter keys this component writes (`QUESTIONS_URL_FILTERS`). */
export interface QuestionFilterValues {
  topic: string;
  difficulty: string;
  type: string;
  source: string;
  approved: string;
}

export interface QuestionFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  values: QuestionFilterValues;
  onChange: (changes: Partial<QuestionFilterValues>) => void;
}

const toPick = (filter: string) => (filter === FILTER_ALL ? "" : filter);
const toFilter = (pick: string) => (pick === "" ? FILTER_ALL : pick);

/**
 * A bank's question filters: the search box (question text or topic), then the blueprint's own
 * axes, an exact topic and a difficulty, and the type, source and approval. The topic applies on
 * Enter or on leaving the box, as the server matches it whole; it re-reads the URL's value when
 * that changes, without remounting the box, so typing keeps its focus.
 */
export function QuestionFilters({
  searchInput,
  onSearchInputChange,
  values,
  onChange,
}: QuestionFiltersProps) {
  const t = useTranslations("exams");
  const [topicInput, setTopicInput] = useState(values.topic);
  // React's "store the previous value in state" pattern: a new URL topic (a commit, Back, a
  // cleared filter) resyncs the box during render, never in an effect and never by a remount.
  const [syncedTopic, setSyncedTopic] = useState(values.topic);
  if (values.topic !== syncedTopic) {
    setSyncedTopic(values.topic);
    setTopicInput(values.topic);
  }
  const commitTopic = () => {
    const topic = topicInput.trim();
    if (topic !== values.topic) onChange({ topic });
  };

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("questionBanks.questions.filters.search")}
        placeholder={t("questionBanks.questions.filters.searchPlaceholder")}
        clearLabel={t("questionBanks.questions.filters.clearSearch")}
      />
      <Input
        className="w-full sm:w-40"
        aria-label={t("questionBanks.questions.filters.topic")}
        placeholder={t("questionBanks.questions.filters.topic")}
        maxLength={TOPIC_MAX}
        value={topicInput}
        onChange={(event) => {
          setTopicInput(event.target.value);
        }}
        onBlur={commitTopic}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitTopic();
        }}
      />
      <FilterSelect
        label={t("questionBanks.questions.filters.difficulty")}
        allLabel={t("questionBanks.filters.all")}
        value={toPick(values.difficulty)}
        onChange={(pick) => {
          onChange({ difficulty: toFilter(pick) });
        }}
        options={QUESTION_DIFFICULTIES.map((difficulty) => ({
          id: difficulty,
          name: t(`questionBanks.difficulty.${difficulty}`),
        }))}
      />
      <FilterSelect
        label={t("questionBanks.questions.filters.type")}
        allLabel={t("questionBanks.filters.all")}
        value={toPick(values.type)}
        onChange={(pick) => {
          onChange({ type: toFilter(pick) });
        }}
        options={QUESTION_TYPES.map((type) => ({
          id: type,
          name: t(`questionBanks.types.${type}`),
        }))}
      />
      <FilterSelect
        label={t("questionBanks.questions.filters.source")}
        allLabel={t("questionBanks.filters.all")}
        value={toPick(values.source)}
        onChange={(pick) => {
          onChange({ source: toFilter(pick) });
        }}
        options={QUESTION_SOURCES.map((source) => ({
          id: source,
          name: t(`questionBanks.sources.${source}`),
        }))}
      />
      <FilterSelect
        label={t("questionBanks.questions.filters.approval")}
        allLabel={t("questionBanks.filters.all")}
        value={toPick(values.approved)}
        onChange={(pick) => {
          onChange({ approved: toFilter(pick) });
        }}
        options={APPROVAL_FILTERS.map((approval) => ({
          id: approval,
          name: t(`questionBanks.questions.approvalFilter.${approval}`),
        }))}
      />
    </>
  );
}
