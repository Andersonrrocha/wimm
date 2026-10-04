-- CreateTable
CREATE TABLE "ChatGptConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tokensEncrypted" TEXT,
    "pendingEncrypted" TEXT,
    "scopes" TEXT NOT NULL,
    "sharing" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "subject" TEXT,
    "accountLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatGptConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatGptConnection_userId_key" ON "ChatGptConnection"("userId");

-- AddForeignKey
ALTER TABLE "ChatGptConnection" ADD CONSTRAINT "ChatGptConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CheckConstraint: none. This table has no enum-shaped scalar column -- every
-- former-enum column in this schema is TEXT with a CHECK (see
-- 20260729120000_enums_to_text), and nothing here is one. `scopes` is an
-- opaque space-separated OAuth scope string whose valid set is the
-- authorization server's to define, not this schema's.
