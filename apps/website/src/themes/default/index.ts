import type { Theme } from "@/themes/types";
import { Footer } from "./chrome/footer";
import { Navigation } from "./chrome/navigation";
import { AboutSchool } from "./sections/about-school";
import { AdmissionsCta } from "./sections/admissions-cta";
import { ClassesList } from "./sections/classes-list";
import { ContactForm } from "./sections/contact-form";
import { DepartmentsGrid } from "./sections/departments-grid";
import { EventsList } from "./sections/events-list";
import { Gallery } from "./sections/gallery";
import { Hero } from "./sections/hero";
import { NewsList } from "./sections/news-list";
import { NoticeBoard } from "./sections/notice-board";
import { PrincipalMessage } from "./sections/principal-message";
import { TeachersGrid } from "./sections/teachers-grid";

/**
 * Theme v1 — the default theme (website-builder.md §2).
 *
 * `section.type → component`. A type missing from this map renders nothing, which is what
 * makes content survive theme switches and new section types safe to ship.
 */
export const defaultTheme: Theme = {
  name: "default",
  label: "SchoolHub Default",
  sections: {
    hero: Hero,
    about_school: AboutSchool,
    principal_message: PrincipalMessage,
    departments_grid: DepartmentsGrid,
    teachers_grid: TeachersGrid,
    classes_list: ClassesList,
    admissions_cta: AdmissionsCta,
    events_list: EventsList,
    news_list: NewsList,
    notice_board: NoticeBoard,
    gallery: Gallery,
    contact_form: ContactForm,
  },
  Navigation,
  Footer,
};

export { themeStyle, THEME_TOKENS } from "./tokens";
