/** The news domain's constants. Reads live under `WEBSITE_QUERY_MODULE` (`website-content.ts`). */
export const NEWS_POSTS_RESOURCE = "news-posts";

/** The public website path a slug of this kind sits under (the renderer's route). */
export const NEWS_PATH_PREFIX = "/news/";

/** `NewsPost.excerpt`'s column length (`website_cms/models.py`). */
export const NEWS_EXCERPT_MAX = 500;

/** Sortable column id -> `NewsPostViewSet.ordering_fields`. */
export const NEWS_SORT_FIELD: Readonly<Record<string, string>> = {
  title: "title",
  status: "status",
  published_at: "published_at",
  updated_at: "updated_at",
};
