import factory

from core.jobs.models import BackgroundJob


class BackgroundJobFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = BackgroundJob

    job_type = "import.students"
