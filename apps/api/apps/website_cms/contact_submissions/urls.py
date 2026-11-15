"""Routes for `/contact-submissions` (module doc §16): staff read and triage only."""

from django.urls import path

from apps.website_cms.contact_submissions.viewset import ContactSubmissionViewSet

urlpatterns = [
    path(
        "contact-submissions",
        ContactSubmissionViewSet.as_view({"get": "list"}),
        name="contact-submissions-list",
    ),
    path(
        "contact-submissions/<uuid:pk>",
        ContactSubmissionViewSet.as_view({"get": "retrieve", "patch": "partial_update"}),
        name="contact-submissions-detail",
    ),
]
