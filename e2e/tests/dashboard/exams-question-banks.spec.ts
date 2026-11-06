import { expect, test } from "@/fixtures";
import { buildRole, buildUser } from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  buildQuestion,
  buildQuestionBank,
  buildSubject,
  examsQuestionBanksModule,
  type MockApi,
  paperUrl,
  type Question,
  type QuestionBank,
  schoolOrganizationModule,
} from "@/mocks";

/**
 * Question banks and paper assembly (PR E) against a stubbed API. The stub
 * (`examsQuestionBanksModule`) enforces the server's rules the screens surface (L5): an `assigned`
 * teacher's record scope (their subjects' banks, any class; any other bank a 404), an AI draft
 * saved unapproved, `:approve` refused on a manual question, and `:assemble-paper` counting
 * approved questions only and naming every short section before any job. Whether the server
 * really does is the live lane's (`tests/live/api/exams-question-banks.spec.ts`).
 *
 * Route ownership: `examsQuestionBanksModule` also owns `GET /jobs/:jobId` and
 * `POST /files/:fileAction`, so no spec here registers `jobsModule`.
 */

const maths = buildSubject({ name: "Mathematics" });
const science = buildSubject({ name: "Science" });

/** A real `teacher`'s question-bank keys (`apps/api/apps/examinations/permissions.py`). */
const TEACHER_KEYS = [
  "exams.question-bank.view",
  "exams.question-bank.create",
  "exams.question-bank.update",
  "exams.question-bank.delete",
  "exams.question.approve",
] as const;

const teacher = buildUser({
  roles: [buildRole({ slug: "teacher", name: "Teacher" })],
  permissions: [...TEACHER_KEYS],
});

// The seeded `exam_staff`'s keys for these screens: every bank key but the approval (§4 gives
// `exams.question.approve` to `teacher` and `vice_principal` only), the subject and class reads
// its pickers make, and the job and file reads behind the paper (seed_e2e_data.py, L27).
const examStaff = buildUser({
  roles: [buildRole({ slug: "exam_staff", name: "Exam Staff" })],
  permissions: [
    "exams.question-bank.view",
    "exams.question-bank.create",
    "exams.question-bank.update",
    "exams.question-bank.delete",
    "school.subject.view",
    "school.class.view",
    "platform.job.view",
    "platform.file.view",
  ],
});

const DRAFT_TEXT = "Which of these is a prime number?";
const APPROVE_PATH = /\/question-banks\/[^/]+\/questions\/[^/]+:approve$/;
const ASSEMBLE_PATH = /\/question-banks\/[^/]+:assemble-paper$/;
const BANKS_PATH = /\/question-banks$/;

interface World {
  mathsBank: QuestionBank;
  scienceBank: QuestionBank;
  questions: Question[];
}

/** A Mathematics bank (two easy questions on one topic, an approved medium one and an AI draft)
 * and a Science bank, built per test: a test's writes change them. */
function stubQuestionBanksApi(mockApi: MockApi, assignedSubjectIds?: string[]): World {
  const mathsBank = buildQuestionBank({
    name: "Algebra basics",
    subject_id: maths.id,
    subject_name: maths.name,
  });
  const scienceBank = buildQuestionBank({
    name: "Forces and motion",
    subject_id: science.id,
    subject_name: science.name,
  });
  const inMaths = { question_bank_id: mathsBank.id };
  const questions = [
    buildQuestion({ ...inMaths, question_text: "Solve 2x + 3 = 7.", topic: "Linear equations" }),
    buildQuestion({ ...inMaths, question_text: "Solve 5x = 20.", topic: "Linear equations" }),
    buildQuestion({ ...inMaths, question_text: "Factorise x² - 9.", difficulty: "medium" }),
    buildQuestion({
      ...inMaths,
      question_text: DRAFT_TEXT,
      question_type: "mcq",
      difficulty: "medium",
      options: ["4", "6", "7", "9"],
      answer_key: "7",
      source: "ai_generated",
      is_approved: false,
    }),
  ];
  mathsBank.question_count = questions.length;
  mockApi.use(
    schoolOrganizationModule({ subjects: [maths, science] }),
    examsQuestionBanksModule({
      banks: [mathsBank, scienceBank],
      questions,
      subjects: [maths, science],
      ...(assignedSubjectIds ? { assignedSubjectIds } : {}),
    }),
  );
  return { mathsBank, scienceBank, questions };
}

test.describe("an assigned teacher", () => {
  test.use({ authUser: teacher });

  test("sees only the banks of the subjects they teach", async ({
    page,
    mockApi,
    dashboardPage,
    questionBanksPage,
    signedIn: _signedIn,
  }) => {
    const { scienceBank } = stubQuestionBanksApi(mockApi, [maths.id]);
    await dashboardPage.goto();

    await dashboardPage.navGroup("Examinations").click();
    await dashboardPage.navLink("Question banks").click();

    await expect(page).toHaveURL(/\/exams\/question-banks$/);
    await expect(questionBanksPage.row("Algebra basics")).toBeVisible();
    await expect(questionBanksPage.row("Every level")).toHaveCount(1);
    await expect(questionBanksPage.row("Forces and motion")).toHaveCount(0);

    await questionBanksPage.gotoBank(scienceBank.id);
    await expect(page.getByText("Question bank not found", { exact: true })).toBeVisible();
  });

  test("approves an AI draft through its confirm, the only row offering Approve", async ({
    page,
    mockApi,
    questionBanksPage,
    signedIn: _signedIn,
  }) => {
    const { mathsBank } = stubQuestionBanksApi(mockApi, [maths.id]);
    await questionBanksPage.gotoBank(mathsBank.id);

    const draft = questionBanksPage.questionRow(DRAFT_TEXT);
    await expect(draft.getByText("AI-generated", { exact: true })).toBeVisible();
    await expect(draft.getByText("Awaiting approval", { exact: true })).toBeVisible();
    await expect(questionBanksPage.anyApproveButton).toHaveCount(1);

    let approveSent = false;
    page.on("request", (r) => {
      if (isApiCall(r, "POST", APPROVE_PATH)) approveSent = true;
    });
    await questionBanksPage.approveButton(DRAFT_TEXT).click();
    const dialog = questionBanksPage.approveDialog;
    await expect(dialog.getByText(DRAFT_TEXT, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("listitem")).toHaveText(["4", "6", "7", "9"]);
    await expect(dialog.getByText(/approval cannot be undone/)).toBeVisible();
    expect(approveSent).toBe(false);

    const approve = page.waitForRequest((r) => isApiCall(r, "POST", APPROVE_PATH));
    await dialog.getByRole("button", { name: "Approve", exact: true }).click();
    await approve;
    await expect(dialog).toHaveCount(0);

    await expect(draft.getByText("Approved by Ayesha Rahman", { exact: true })).toBeVisible();
    // The label stays after approval (ai-governance.md §8); Approve does not.
    await expect(draft.getByText("AI-generated", { exact: true })).toBeVisible();
    await expect(questionBanksPage.anyApproveButton).toHaveCount(0);
  });
});

test.describe("the exam staff", () => {
  test.use({ authUser: examStaff });

  test("is offered no Approve, holding no approval key", async ({
    mockApi,
    questionBanksPage,
    signedIn: _signedIn,
  }) => {
    const { mathsBank } = stubQuestionBanksApi(mockApi);
    await questionBanksPage.gotoBank(mathsBank.id);

    await expect(questionBanksPage.questionRow(DRAFT_TEXT)).toBeVisible();
    await expect(questionBanksPage.anyApproveButton).toHaveCount(0);
  });

  test("creates a bank for every level", async ({
    page,
    mockApi,
    questionBanksPage,
    signedIn: _signedIn,
  }) => {
    stubQuestionBanksApi(mockApi);
    await questionBanksPage.goto();

    await questionBanksPage.createButton.click();
    const dialog = page.getByRole("dialog", { name: "New question bank" });
    await dialog.getByLabel("Name", { exact: true }).fill("Fractions");
    await dialog.getByRole("combobox", { name: "Subject", exact: true }).click();
    await questionBanksPage.option("Mathematics").click();
    const create = page.waitForRequest((r) => isApiCall(r, "POST", BANKS_PATH));
    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    expect((await create).postDataJSON()).toEqual({
      name: "Fractions",
      subject_id: maths.id,
      class_id: null,
      description: null,
      status: "active",
    });
    await expect(questionBanksPage.row("Fractions")).toBeVisible();
  });

  test("is told every section the bank cannot fill, then downloads a paper it can", async ({
    page,
    mockApi,
    questionBanksPage,
    signedIn: _signedIn,
  }) => {
    const { mathsBank } = stubQuestionBanksApi(mockApi);
    // Storage signs the link with `Content-Disposition: attachment`, which makes Chromium emit
    // the `download` event for a cross-origin link.
    await page.route(paperUrl("*"), (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: { "content-disposition": 'attachment; filename="paper.pdf"' },
        body: "%PDF-1.4",
      }),
    );
    await questionBanksPage.gotoBank(mathsBank.id);

    await questionBanksPage.assembleButton.click();
    await expect(
      questionBanksPage.paperDialog.getByText(/Papers aren't kept on SchoolHub/),
    ).toBeVisible();
    await questionBanksPage.paperTitle.fill("Term test");
    await questionBanksPage.sectionDifficulty(1).click();
    await questionBanksPage.option("Easy").click();
    await questionBanksPage.sectionField(1, "Questions").fill("5");
    await questionBanksPage.addSectionButton.click();
    await questionBanksPage.sectionDifficulty(2).click();
    await questionBanksPage.option("Hard").click();
    await questionBanksPage.sectionField(2, "Questions").fill("2");
    await questionBanksPage.submitPaperButton.click();

    await expect(
      questionBanksPage.paperDialog.getByText(
        "Section 1 asks for 5 easy questions; the bank has 2 approved.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      questionBanksPage.paperDialog.getByText(
        "Section 2 asks for 2 hard questions; the bank has 0 approved.",
        { exact: true },
      ),
    ).toBeVisible();

    // Two medium questions exist, the approved one and the AI draft; the draft is not approved,
    // so the server counts one, and says so in its own sentence (`assemble_paper`).
    await questionBanksPage.sectionField(1, "Questions").fill("2");
    await questionBanksPage.sectionField(1, "Topic").fill("Linear equations");
    await questionBanksPage.sectionDifficulty(2).click();
    await questionBanksPage.option("Medium").click();
    await questionBanksPage.sectionField(2, "Questions").fill("2");
    await questionBanksPage.submitPaperButton.click();

    await expect(
      questionBanksPage.paperDialog.getByText(
        "1 section(s) of this blueprint cannot be filled from the bank's approved questions.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      questionBanksPage.paperDialog.getByText(
        "Section 2 asks for 2 medium questions; the bank has 1 approved.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(questionBanksPage.paperDialog.getByText(/^Section 1 asks for/)).toHaveCount(0);

    // Two easy questions on the topic, and the one approved medium question.
    await questionBanksPage.sectionField(2, "Questions").fill("1");
    const assemble = page.waitForRequest((r) => isApiCall(r, "POST", ASSEMBLE_PATH));
    const download = page.waitForEvent("download");
    await questionBanksPage.submitPaperButton.click();

    expect((await assemble).postDataJSON()).toEqual({
      title: "Term test",
      sections: [
        { difficulty: "easy", count: 2, topic: "Linear equations" },
        { difficulty: "medium", count: 1 },
      ],
    });
    expect((await download).url()).toMatch(/^https:\/\/storage\.e2e\.test\/papers\/.+\.pdf$/);
    await expect(page.getByText("Paper downloaded: 3 questions, 3.00 marks.")).toBeVisible();
  });
});
