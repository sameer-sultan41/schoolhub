"""Routes for the website module (module doc §16).

Pure aggregator: each resource declares its routes in its own package's ``urls.py`` and is
included here. No resource exists yet.
"""

from django.urls import URLPattern, URLResolver

urlpatterns: list[URLPattern | URLResolver] = []
