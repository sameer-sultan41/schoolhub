from django.urls import path

from core.ai.views import AIRequestFeedbackView, AIUsageView

urlpatterns = [
    path("ai/usage", AIUsageView.as_view(), name="ai-usage"),
    path(
        "ai/requests/<uuid:pk>:feedback",
        AIRequestFeedbackView.as_view(),
        name="ai-request-feedback",
    ),
]
