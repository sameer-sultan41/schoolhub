"""Enable Row-Level Security on `question_banks` and `questions`.

Both are new in `0009_question_banks` and touched by no other app's migrations,
so none of the "already covered elsewhere" exclusions other modules carry apply.

`apps/api/tests/test_rls_coverage.py` fails the build without it. `questions`
carries `answer_key`, which makes this the one table in the module where a
cross-tenant read would hand somebody another school's mark scheme before the
paper is sat.

These are the last two tables `examinations` owns.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("examinations", "0009_question_banks")]
    operations = [*rls_operations("question_banks", "questions")]
