import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'

/**
 * Marks a route handler (or every handler on a controller class) as exempt
 * from the global `JwtAuthGuard`. Without this, every route requires a
 * valid JWT by default.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
