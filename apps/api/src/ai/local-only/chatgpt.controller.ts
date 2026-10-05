import { Controller, Get, Post } from '@nestjs/common'
import type { JwtPayload } from '../../auth/strategies/jwt.strategy'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ChatGptConnectFlow } from './chatgpt-connect-flow'
import {
  type ChatGptConnectionStatus,
  ChatGptConnectionStore,
} from './chatgpt-connection.store'

/**
 * The ChatGPT plan-usage connection, as three routes.
 *
 * Registered by `LocalOnlyAiModule` and therefore bound only in the local
 * composition (`app.local.module.ts`); `app.module.ts` must never reach this
 * file. `SessionTokenGuard` is registered as `APP_GUARD` there, so these
 * routes are covered by it like every other -- `local-route-posture.spec.ts`
 * discovers them off the live Express router rather than from a list, so
 * that coverage is automatic and cannot silently lapse.
 *
 * **Nothing here holds logic.** `connect` and `disconnect` are one
 * `ChatGptConnectFlow` call each; `status` is one call to the store, whose
 * `status()` is documented as the only view of a connection allowed to
 * leave it. Routing one of those three through the flow instead would add a
 * hop that did nothing but forward.
 *
 * **There is no DTO because there is no input.** None of the three takes a
 * body, a query parameter or a path parameter: the only input is the caller's
 * identity, which comes from `@CurrentUser()` (set by
 * `ActiveProfileMiddleware` in this composition) and is never read off the
 * request by this file. The project rule is to validate every input with
 * `class-validator`, and an empty DTO class would be ceremony that validates
 * nothing. If any of these ever grows a parameter, it needs a DTO.
 *
 * **No response here can carry a credential.** All three return
 * `ChatGptConnectionStatus`, which has no field a token could sit in --
 * `chatgpt.controller.spec.ts` asserts that recursively over the real HTTP
 * bodies, and pins the exact key set.
 */
@Controller('ai/chatgpt')
export class ChatGptController {
  constructor(
    private readonly flow: ChatGptConnectFlow,
    private readonly store: ChatGptConnectionStore,
  ) {}

  /**
   * Opens the user's browser and completes one sign-in. Blocks until the
   * authorization server redirects back, the user declines, or the listener
   * times out -- it is an interactive flow, and the desktop client calls it
   * from a button press.
   */
  @Post('connect')
  connect(@CurrentUser() user: JwtPayload): Promise<ChatGptConnectionStatus> {
    return this.flow.connect(user.sub)
  }

  @Get('status')
  status(@CurrentUser() user: JwtPayload): Promise<ChatGptConnectionStatus> {
    return this.store.status(user.sub)
  }

  @Post('disconnect')
  disconnect(@CurrentUser() user: JwtPayload): Promise<ChatGptConnectionStatus> {
    return this.flow.disconnect(user.sub)
  }
}
