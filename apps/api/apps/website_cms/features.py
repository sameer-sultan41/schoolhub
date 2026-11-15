from core.tenancy.features import registry

#: The one definition; every viewset's `required_feature` and every service gate imports it.
FEATURE = "module.website"

registry.register(
    FEATURE,
    "Website & CMS (pages, news, events, gallery, navigation, SEO, custom domains).",
    default_enabled=False,
)
