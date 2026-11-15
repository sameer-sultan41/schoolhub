"""Permission keys for the website module — docs/03-modules/website-cms.md §4.

`website.page.view` is the CMS read key for all website content, including news, events and
galleries (§4 declares no view key for those), and every CMS view imports it as
`PAGE_VIEW_KEY`. The renderer's `website.public-content.view` scope is deliberately NOT
registered here: it is a machine scope, to be declared in `MACHINE_SCOPES` in
core/rbac/machine.py (PR C), not a grantable role permission.
"""

from core.rbac.registry import registry

PAGE_READERS = ("school_admin", "it_admin", "principal")
CONTENT_EDITORS = ("school_admin",)
PUBLISHERS = ("school_admin", "principal")
SITE_ADMINS = ("it_admin", "school_admin")
DOMAIN_ADMINS = ("it_admin", "school_owner")
INBOX_STAFF = ("reception", "school_admin")

PAGE_VIEW_KEY = "website.page.view"

registry.register(
    PAGE_VIEW_KEY, "View pages, sections and website content in the CMS.", PAGE_READERS
)
registry.register("website.page.create", "Create pages and sections.", CONTENT_EDITORS)
registry.register("website.page.update", "Edit pages and sections.", CONTENT_EDITORS)
registry.register("website.page.delete", "Delete pages and sections.", CONTENT_EDITORS)
registry.register("website.page.publish", "Publish or unpublish pages.", PUBLISHERS)

registry.register("website.news-post.create", "Create news posts.", CONTENT_EDITORS)
registry.register("website.news-post.update", "Edit news posts.", CONTENT_EDITORS)
registry.register("website.news-post.delete", "Delete news posts.", CONTENT_EDITORS)
registry.register("website.news-post.publish", "Publish or unpublish news.", PUBLISHERS)

registry.register("website.school-event.create", "Create website events.", CONTENT_EDITORS)
registry.register("website.school-event.update", "Edit website events.", CONTENT_EDITORS)
registry.register("website.school-event.publish", "Publish website events.", CONTENT_EDITORS)

registry.register("website.gallery-album.create", "Create gallery albums.", CONTENT_EDITORS)
registry.register(
    "website.gallery-album.update", "Edit gallery albums and their items.", CONTENT_EDITORS
)
registry.register("website.gallery-album.publish", "Publish gallery albums.", CONTENT_EDITORS)
registry.register("website.gallery-album.delete", "Delete gallery albums.", CONTENT_EDITORS)

registry.register("website.navigation.update", "Edit the header and footer menus.", SITE_ADMINS)
registry.register(
    "website.settings.update",
    "Theme config, homepage assignment, publish and maintenance toggles.",
    SITE_ADMINS,
)
registry.register("website.seo.update", "Edit site and per-content SEO settings.", SITE_ADMINS)

registry.register("website.custom-domain.create", "Bind a custom domain.", DOMAIN_ADMINS)
registry.register(
    "website.custom-domain.update", "Verify or change a custom domain.", DOMAIN_ADMINS
)
registry.register("website.custom-domain.delete", "Remove a custom domain.", DOMAIN_ADMINS)

registry.register("website.contact-submission.view", "Read contact-form submissions.", INBOX_STAFF)
registry.register(
    "website.contact-submission.update", "Triage contact-form submissions.", INBOX_STAFF
)
