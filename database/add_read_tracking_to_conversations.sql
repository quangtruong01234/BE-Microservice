-- P1-06: chat conversation metadata — per-user read tracking so the conversation
-- list can return unreadCount alongside lastMessage. One nullable marker per side;
-- NULL means "never opened" → every inbound message counts as unread.
ALTER TABLE conversations
  ADD COLUMN user1_last_read_at DATETIME NULL DEFAULT NULL AFTER user2_id,
  ADD COLUMN user2_last_read_at DATETIME NULL DEFAULT NULL AFTER user1_last_read_at;
