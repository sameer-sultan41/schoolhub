"""The standard pages a new site starts with (plan decision 10).

Every page is a draft with valid placeholder sections from theme v1, so the school edits
real text rather than facing an empty site. `tests` assert each one passes
`validate_section_content`.
"""

from __future__ import annotations

from typing import Any

from apps.website_cms.models import PageType

#: (page_type, slug, title, [(section_type, content), ...])
DEFAULT_PAGES: tuple[tuple[str, str, str, tuple[tuple[str, dict[str, Any]], ...]], ...] = (
    (
        PageType.HOME,
        "home",
        "Home",
        (
            ("hero", {"heading": "Welcome to our school", "subheading": "Edit this headline."}),
            ("news_list", {"heading": "Latest news", "limit": 3}),
            ("events_list", {"heading": "Upcoming events", "limit": 3}),
        ),
    ),
    (
        PageType.ABOUT,
        "about",
        "About us",
        (("about_school", {"heading": "About us", "body": "Tell visitors about your school."}),),
    ),
    (
        PageType.PRINCIPAL_MESSAGE,
        "principal-message",
        "Principal's message",
        (
            (
                "principal_message",
                {"heading": "Principal's message", "message": "Write a welcome message here."},
            ),
        ),
    ),
    (
        PageType.DEPARTMENTS,
        "departments",
        "Departments",
        (("departments_grid", {"heading": "Our departments"}),),
    ),
    (PageType.TEACHERS, "teachers", "Teachers", (("teachers_grid", {"heading": "Our teachers"}),)),
    (PageType.CLASSES, "classes", "Classes", (("classes_list", {"heading": "Our classes"}),)),
    (
        PageType.ADMISSIONS,
        "admissions",
        "Admissions",
        (
            (
                "admissions_cta",
                {"heading": "Join us", "body": "Explain how families can apply."},
            ),
        ),
    ),
    (
        PageType.CONTACT,
        "contact",
        "Contact us",
        (("contact_form", {"heading": "Get in touch", "form": "contact"}),),
    ),
)
