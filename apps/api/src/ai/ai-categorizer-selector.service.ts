import { Injectable, Logger } from '@nestjs/common'
import { AiByokSource, AiCategorizationMode } from '@wimm/shared'
import { PrismaService } from '../prisma/prisma.service'
import type { AiProvider } from './ai-provider.interface'
import { AiProviderRegistry } from './ai-provider.registry'

/**
 * The provider that answers under `AiCategorizationMode.SERVER`, and the one
 * `AiByokSource.ANTHROPIC_KEY` names. `SERVER` means the server's own key
 * pays, which only the Anthropic provider can do.
 */
const ANTHROPIC_PROVIDER_ID = 'anthropic'

/**
 * Which provider each own-credential source resolves to.
 *
 * `Record<AiByokSource, string>` on purpose: it makes the map exhaustive over
 * the enum, so a third source cannot be added in `@wimm/shared` without the
 * compiler stopping here. This is the single place where a persisted,
 * user-facing enum value becomes an `AiProvider.id` -- ids themselves are
 * never persisted and never shown (see `ai-provider.interface.ts`).
 */
const BYOK_SOURCE_PROVIDER_IDS: Record<AiByokSource, string> = {
  [AiByokSource.ANTHROPIC_KEY]: ANTHROPIC_PROVIDER_ID,
  [AiByokSource.CHATGPT_PLAN]: 'chatgpt-oauth',
}

export interface AiSelection {
  /** The provider to use, or `null` to make no suggestion at all. */
  provider: AiProvider | null
  /**
   * Both own-credential sources are available and the user has not chosen.
   * `provider` is `null`; the UI asks, nothing is guessed.
   */
  needsChoice: boolean
}

/** No provider, and nothing for the user to decide. */
const NOTHING: AiSelection = { provider: null, needsChoice: false }

/**
 * Picks which `AiProvider` categorizes for a given user, from their AI mode
 * and what credentials they actually have.
 *
 * **The rule, decided by the owner on 2026-10-08.** When more than one
 * credential source is available the user chooses; when only one is
 * available it is used without asking. That asymmetry is the whole reason
 * this class exists -- a user who connects a ChatGPT plan and stores no
 * `sk-ant-` key must get suggestions immediately, and a user with both must
 * not have one picked for them.
 *
 * **`SERVER` never routes to a ChatGPT plan.** That mode means the server's
 * own key pays; spending a user's personal plan allowance under it would be
 * the opposite of what they selected, even when a plan is connected and
 * `aiByokSource` names it.
 *
 * **What this does not do.** It does not gate on `OFF` *for the caller*:
 * `OFF` returns no provider here, but `ImportsService` still has its own
 * earlier `OFF` check, deliberately ahead of the candidate query it would
 * otherwise spend on someone who never enabled AI. Do not delete that gate
 * on the strength of this one.
 *
 * **Failure posture.** A provider whose `hasCredentialFor` rejects is treated
 * as unavailable, and only that provider: one broken credential check must
 * not hide the user's other, working source. The user row read is not
 * swallowed -- it propagates, exactly as `AiKeyResolverService`'s does, and
 * the import path's existing try/catch is what keeps AI advisory. Call this
 * from inside that try/catch; a preview must never fail because selection
 * failed.
 */
@Injectable()
export class AiCategorizerSelector {
  private readonly logger = new Logger(AiCategorizerSelector.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AiProviderRegistry,
  ) {}

  async selectFor(userId: string): Promise<AiSelection> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { aiCategorizationMode: true, aiByokSource: true },
    })
    if (!user) return NOTHING

    if (user.aiCategorizationMode === AiCategorizationMode.OFF) return NOTHING

    if (user.aiCategorizationMode === AiCategorizationMode.SERVER) {
      return {
        provider: this.registry.get(ANTHROPIC_PROVIDER_ID) ?? null,
        needsChoice: false,
      }
    }

    if (user.aiCategorizationMode === AiCategorizationMode.BYOK) {
      return this.selectOwnCredential(userId, user.aiByokSource)
    }

    // Unreachable while `User_aiCategorizationMode_check` holds (see
    // `prisma/check-constraints.ts`). Suggesting nothing is the right
    // reading of a value this build does not understand.
    return NOTHING
  }

  /**
   * The `BYOK` branch: which of the user's own credentials to spend.
   *
   * Availability is asked of the providers, not inferred from the stored
   * choice -- a stored `CHATGPT_PLAN` on a user who has since disconnected
   * must not stop their Anthropic key from being used, and vice versa. The
   * choice is consulted only to break a genuine tie.
   */
  private async selectOwnCredential(
    userId: string,
    storedSource: string | null,
  ): Promise<AiSelection> {
    const available: Array<{ source: AiByokSource; provider: AiProvider }> = []

    for (const [source, id] of Object.entries(BYOK_SOURCE_PROVIDER_IDS) as Array<
      [AiByokSource, string]
    >) {
      const provider = this.registry.get(id)
      // Absent rather than unavailable: the hosted composition registers no
      // ChatGPT provider at all, which is a licensing boundary, not a
      // credential state.
      if (!provider) continue
      if (await this.hasCredential(provider, userId)) {
        available.push({ source, provider })
      }
    }

    if (available.length === 0) return NOTHING
    if (available.length === 1) {
      return { provider: available[0]!.provider, needsChoice: false }
    }

    const chosen = available.find((candidate) => candidate.source === storedSource)
    if (!chosen) return { provider: null, needsChoice: true }
    return { provider: chosen.provider, needsChoice: false }
  }

  /**
   * One provider's availability, with its failures contained.
   *
   * A provider that cannot answer is not available, and that is as far as the
   * failure travels: letting it propagate would discard the other source's
   * answer too, so a user with a working Anthropic key would get no
   * suggestions because a ChatGPT store read failed. The log line names the
   * provider id and the message only -- `hasCredentialFor` is contractually
   * forbidden from putting any part of a credential in either.
   */
  private async hasCredential(
    provider: AiProvider,
    userId: string,
  ): Promise<boolean> {
    try {
      return await provider.hasCredentialFor(userId)
    } catch (err) {
      this.logger.warn(
        `AI provider "${provider.id}" could not report credential availability: ${
          (err as Error).message
        }`,
      )
      return false
    }
  }
}
