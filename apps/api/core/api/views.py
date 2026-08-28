"""Infrastructure endpoints.

Kept deliberately dependency-light: a liveness probe that touches the database will
take the whole service out of rotation during a brief database blip.
"""

from django.db import connection
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt


@csrf_exempt
def health(request):
    """Liveness: is the process up and serving?"""
    return JsonResponse({"status": "ok"})


@csrf_exempt
def readiness(request):
    """Readiness: can this instance serve traffic (database reachable)?"""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:
        return JsonResponse({"status": "unavailable"}, status=503)
    return JsonResponse({"status": "ready"})
