import {
  archiveNewsPost,
  createNewsPost,
  deleteNewsPost,
  fetchNewsPost,
  fetchNewsPostPage,
  publishNewsPost,
  unpublishNewsPost,
  updateNewsPost,
} from "./news-posts-service";

export const NewsPostsService = {
  fetchNewsPostPage,
  fetchNewsPost,
  createNewsPost,
  updateNewsPost,
  deleteNewsPost,
  publishNewsPost,
  unpublishNewsPost,
  archiveNewsPost,
};
export type {
  NewsPostDetail,
  NewsPostInput,
  NewsPostQuery,
  NewsPostRecord,
  NewsPostUpdateInput,
} from "./news-posts-type";
