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
