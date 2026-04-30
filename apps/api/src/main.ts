import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  // Behind Caddy reverse proxy: trust the X-Forwarded-For header so per-IP
  // rate limiting and request logging see the real client IP.
  app.set('trust proxy', 1)

  app.setGlobalPrefix('api')
  app.enableCors()
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  const port = process.env.PORT ?? 3000
  await app.listen(port)

  console.log(`API running on http://localhost:${port}/api`)
}

bootstrap()
