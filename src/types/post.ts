export interface Post {
    id: string;
    author_did: string;
    title: string;
    content: string;
    subreddit?: string;
    created_at: string;
    updated_at: string;
}

export interface CreatePostDto {
    title: string;
    content: string;
    subreddit?: string;
}
