import { useNavigate, useSearchParams } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { createEvent } from '../api/client'
import { AppHeader } from '../components/AppHeader'
import { Button } from '../components/primitives'
import { EventComposer, type ComposerPayload } from '../components/events/EventComposer'

const DISCORD_CHANNEL_ID_PATTERN = /^\d{17,20}$/

export function EventCreatePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const channelFromQuery = searchParams.get('channel')?.trim() ?? ''
  const presetChannelId = DISCORD_CHANNEL_ID_PATTERN.test(channelFromQuery)
    ? channelFromQuery
    : ''

  const mutation = useMutation({
    mutationFn: (payload: ComposerPayload) =>
      createEvent({
        title: payload.title,
        description: payload.description,
        defaultDurationMinutes: payload.defaultDurationMinutes,
        deadline: payload.deadline,
        timezone: payload.timezone,
        discordChannelId: payload.discordChannelId,
        candidates: payload.candidates,
      }),
    onSuccess: (result) => {
      navigate('/events/' + result.event.id)
    },
  })

  return (
    <div>
      <AppHeader
        right={
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            キャンセル
          </Button>
        }
      />
      <main style={{ maxWidth: 600, margin: '0 auto', padding: '40px 24px 96px' }}>
        <h2
          style={{
            margin: '0 0 6px',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--color-fg1)',
          }}
        >
          日程調整をつくる
        </h2>
        <p style={{ margin: '0 0 28px', fontSize: 15, color: 'var(--color-fg2)' }}>
          候補日を出すと、回答用のリンクができます。
        </p>
        <EventComposer
          mode="create"
          presetDiscordChannelId={presetChannelId || undefined}
          submitLabel="この内容でつくる"
          submittingLabel="作成中..."
          isSubmitting={mutation.isPending}
          errorMessage={mutation.error?.message}
          onSubmit={(payload) => mutation.mutate(payload)}
        />
      </main>
    </div>
  )
}
