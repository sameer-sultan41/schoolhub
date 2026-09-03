from __future__ import annotations

import factory

from core.files.models import File, FileStatus


class FileFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = File

    storage_key = factory.Sequence(lambda n: f"tenants/test/student.document/{n}-file.pdf")
    original_name = factory.Sequence(lambda n: f"file-{n}.pdf")
    mime_type = "application/pdf"
    size_bytes = 1024
    purpose = "student.document"
    status = FileStatus.READY
