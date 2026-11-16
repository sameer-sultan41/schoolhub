"""Enable Row-Level Security on the news, event and gallery tables."""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("website_cms", "0003_content_models")]
    operations = [
        *rls_operations("news_posts", "school_events", "gallery_albums", "gallery_items"),
    ]
