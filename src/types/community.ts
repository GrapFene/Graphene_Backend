export interface Community {
    id: string;
    name: string;
    description?: string;
    owner_did: string;
    topic?: string;
    is_private: boolean;
    rules: CommunityRules;
    created_at: string;
    is_federated: boolean;
    home_instance_domain?: string | null;
}

export interface CommunityRules {
    min_account_age_days?: number;
    min_reputation?: number; // Future use
    restricted_posting?: boolean; // Only moderators/owner can post
}

export interface CreateCommunityDto {
    name: string;
    description?: string;
    topic?: string;
    is_private?: boolean;
    rules?: CommunityRules;
    is_federated?: boolean;
    home_instance_domain?: string;
}

export interface UpdateCommunityRulesDto {
    rules: CommunityRules;
}
