import { buildPrompt, mapSuggestions } from './categorize-suggestions'

const candidates = [
  { id: 'cat-groceries', name: 'Groceries' },
  { id: 'cat-rent', name: 'Rent' },
]

describe('mapSuggestions', () => {
  it('keeps a candidate id the model was confident about', () => {
    expect(
      mapSuggestions(
        { suggestions: [{ index: 0, categoryId: 'cat-rent', confidence: 0.9 }] },
        candidates,
      ),
    ).toEqual([{ index: 0, categoryId: 'cat-rent', confidence: 0.9 }])
  })

  // The model is told to use ids verbatim and not to invent them. This is what
  // makes that instruction safe to rely on, not the instruction itself.
  it('refuses a categoryId that is not in the candidate list, however confident', () => {
    expect(
      mapSuggestions(
        { suggestions: [{ index: 3, categoryId: 'cat-invented', confidence: 0.99 }] },
        candidates,
      ),
    ).toEqual([{ index: 3, categoryId: null, confidence: 0.99 }])
  })

  it('refuses an id that only resembles a candidate', () => {
    // Substring and case variants of a real id are not the real id.
    const out = mapSuggestions(
      {
        suggestions: [
          { index: 0, categoryId: 'cat-rent ', confidence: 0.9 },
          { index: 1, categoryId: 'CAT-RENT', confidence: 0.9 },
          { index: 2, categoryId: 'cat-ren', confidence: 0.9 },
        ],
      },
      candidates,
    )

    expect(out.map((r) => r.categoryId)).toEqual([null, null, null])
  })

  it('accepts a confidence of exactly 0.6 and refuses anything below it', () => {
    const out = mapSuggestions(
      {
        suggestions: [
          { index: 0, categoryId: 'cat-rent', confidence: 0.6 },
          { index: 1, categoryId: 'cat-rent', confidence: 0.59 },
        ],
      },
      candidates,
    )

    expect(out).toEqual([
      { index: 0, categoryId: 'cat-rent', confidence: 0.6 },
      { index: 1, categoryId: null, confidence: 0.59 },
    ])
  })

  it('floors a missing confidence to 0 and so does not believe the category', () => {
    expect(
      mapSuggestions(
        { suggestions: [{ index: 0, categoryId: 'cat-rent' }] },
        candidates,
      ),
    ).toEqual([{ index: 0, categoryId: null, confidence: 0 }])
  })

  it('floors a non-numeric confidence to 0', () => {
    expect(
      mapSuggestions(
        { suggestions: [{ index: 0, categoryId: 'cat-rent', confidence: '0.95' }] },
        candidates,
      ),
    ).toEqual([{ index: 0, categoryId: null, confidence: 0 }])
  })

  it('discards a suggestion whose index is not a number, since no row can take it', () => {
    const out = mapSuggestions(
      {
        suggestions: [
          { index: '0', categoryId: 'cat-rent', confidence: 0.9 },
          { categoryId: 'cat-rent', confidence: 0.9 },
          { index: null, categoryId: 'cat-rent', confidence: 0.9 },
          { index: 2, categoryId: 'cat-rent', confidence: 0.9 },
        ],
      },
      candidates,
    )

    expect(out).toEqual([{ index: 2, categoryId: 'cat-rent', confidence: 0.9 }])
  })

  it('passes an explicit null category through as null', () => {
    expect(
      mapSuggestions(
        { suggestions: [{ index: 0, categoryId: null, confidence: 0.2 }] },
        candidates,
      ),
    ).toEqual([{ index: 0, categoryId: null, confidence: 0.2 }])
  })

  it('treats a non-string categoryId as no category', () => {
    expect(
      mapSuggestions(
        { suggestions: [{ index: 0, categoryId: 7, confidence: 0.9 }] },
        candidates,
      ),
    ).toEqual([{ index: 0, categoryId: null, confidence: 0.9 }])
  })

  it('returns one result per usable suggestion, in the order given', () => {
    const out = mapSuggestions(
      {
        suggestions: [
          { index: 5, categoryId: 'cat-groceries', confidence: 0.8 },
          { index: 1, categoryId: 'cat-rent', confidence: 0.7 },
        ],
      },
      candidates,
    )

    expect(out.map((r) => r.index)).toEqual([5, 1])
  })

  it('returns nothing when there are no suggestions', () => {
    expect(mapSuggestions({}, candidates)).toEqual([])
    expect(mapSuggestions({ suggestions: [] }, candidates)).toEqual([])
  })

  it('refuses every id when there are no candidates', () => {
    expect(
      mapSuggestions(
        { suggestions: [{ index: 0, categoryId: 'cat-rent', confidence: 0.9 }] },
        [],
      ),
    ).toEqual([{ index: 0, categoryId: null, confidence: 0.9 }])
  })
})

describe('mapSuggestions: malformed input must cost one entry, never the batch', () => {
  // Every case below used to throw a raw TypeError out of `categorizeBatch`.
  // `ImportsService` catches that and logs it, so the price was the WHOLE
  // batch's suggestions rather than the one bad entry -- and the exposure is
  // the Anthropic path, the one that runs today: OpenAI's `strict: true`
  // constrains items to objects, Anthropic's non-strict schema does not.
  const good = { index: 0, categoryId: 'cat-groceries', confidence: 0.9 }

  it('skips a null element and keeps the rest of the batch', () => {
    const out = mapSuggestions(
      { suggestions: [null, good] } as never,
      candidates,
    )
    expect(out).toEqual([{ index: 0, categoryId: 'cat-groceries', confidence: 0.9 }])
  })

  it.each([42, 'abc', { length: 0 }, null, undefined])(
    'returns nothing, and does not throw, for a suggestions of %p',
    (suggestions) => {
      expect(() =>
        mapSuggestions({ suggestions } as never, candidates),
      ).not.toThrow()
      expect(mapSuggestions({ suggestions } as never, candidates)).toEqual([])
    },
  )

  it.each([Number.NaN, 1.5, -4, Number.POSITIVE_INFINITY])(
    'skips an index of %p, which cannot name a real row',
    (index) => {
      const out = mapSuggestions(
        { suggestions: [{ ...good, index }, good] } as never,
        candidates,
      )
      expect(out).toEqual([{ index: 0, categoryId: 'cat-groceries', confidence: 0.9 }])
    },
  )
})

describe('mapSuggestions: confidence is clamped to [0,1]', () => {
  const base = { index: 0, categoryId: 'cat-groceries' }

  it('clamps a confidence above 1, which the preview rendered as 4200%', () => {
    // `imports-page.tsx` does `Math.round(confidence * 100)`.
    const [result] = mapSuggestions(
      { suggestions: [{ ...base, confidence: 42 }] } as never,
      candidates,
    )
    expect(result!.confidence).toBe(1)
    // Still above the floor, so the category is kept.
    expect(result!.categoryId).toBe('cat-groceries')
  })

  it('clamps a negative confidence to 0 and drops the category with it', () => {
    const [result] = mapSuggestions(
      { suggestions: [{ ...base, confidence: -5 }] } as never,
      candidates,
    )
    expect(result!.confidence).toBe(0)
    expect(result!.categoryId).toBeNull()
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 'high', null, undefined])(
    'reads a confidence of %p as 0 rather than passing it on',
    (confidence) => {
      const [result] = mapSuggestions(
        { suggestions: [{ ...base, confidence }] } as never,
        candidates,
      )
      expect(result!.confidence).toBe(0)
      expect(result!.categoryId).toBeNull()
    },
  )
})

describe('buildPrompt', () => {
  const transactions = [
    { index: 0, description: 'Mercado Livre', amount: '123.45' },
    { index: 4, description: 'Uber *Trip', amount: '-9.90' },
  ]

  // Pinned in full on purpose. Two providers share this text, and a change to
  // it changes what both ask the model; that should be a visible edit to this
  // expectation, not a side effect.
  it('builds the shared prompt, ending with the transport-specific line', () => {
    expect(buildPrompt(transactions, candidates, 'SUBMIT-LINE')).toBe(
      [
        'You are a personal-finance assistant categorizing transactions for a user.',
        'For each transaction below, pick the single best-matching category from the candidate list, or return null if none fits well.',
        'Use the categoryId verbatim from the candidate list. Do not invent ids.',
        'Confidence should reflect how sure you are: 0.9+ for obvious matches, 0.6-0.8 for likely matches, below 0.6 (returns null) when guessing.',
        '',
        'Candidate categories (id: name):',
        '- cat-groceries: Groceries',
        '- cat-rent: Rent',
        '',
        'Transactions to categorize:',
        '0. amount=123.45 description="Mercado Livre"',
        '4. amount=-9.90 description="Uber *Trip"',
        '',
        'SUBMIT-LINE',
      ].join('\n'),
    )
  })

  it('sends only index, amount and description for a transaction', () => {
    // Privacy contract: nothing beyond those three fields may reach a
    // provider, even if a caller hands over a richer object.
    const rich = [
      {
        index: 0,
        description: 'Mercado Livre',
        amount: '10.00',
        sourceName: 'Itau Checking',
        accountNumber: '12345-6',
        userId: 'user-secret-id',
      },
    ]

    const prompt = buildPrompt(rich, candidates, 'SUBMIT-LINE')

    expect(prompt).not.toContain('Itau')
    expect(prompt).not.toContain('12345-6')
    expect(prompt).not.toContain('user-secret-id')
  })
})
