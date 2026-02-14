export interface Post {
    id: string;
    author_did: string;
    title: string;
    content: string;
    subreddit?: string;
    media_url?: string;
    media_type?: 'image' | 'video';
    created_at: string;
    updated_at: string;

    // Federation & Trust
    signature?: string;
    signer_did?: string;
    is_verified?: boolean;
    source_instance_url?: string;
}

export interface CreatePostDto {
    title: string;
    content: string;
    subreddit?: string;
    media_url?: string;
    media_type?: 'image' | 'video';
}
