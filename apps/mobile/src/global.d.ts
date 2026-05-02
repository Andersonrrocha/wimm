/**
 * React 19 stopped exposing the JSX namespace globally — `JSX.Element`,
 * `JSX.IntrinsicElements`, etc. now live under `React.JSX`. To avoid
 * touching every file (~45) that uses `JSX.Element` as a return type,
 * we re-expose those types globally here.
 *
 * Drop this file once the codebase migrates to inferred return types or
 * `React.JSX.Element`.
 */
import * as React from 'react'

declare global {
  namespace JSX {
    type Element = React.JSX.Element
    type ElementType = React.JSX.ElementType
    type ElementClass = React.JSX.ElementClass
    type ElementAttributesProperty = React.JSX.ElementAttributesProperty
    type ElementChildrenAttribute = React.JSX.ElementChildrenAttribute
    type IntrinsicAttributes = React.JSX.IntrinsicAttributes
    type IntrinsicClassAttributes<T> = React.JSX.IntrinsicClassAttributes<T>
    type IntrinsicElements = React.JSX.IntrinsicElements
    type LibraryManagedAttributes<C, P> = React.JSX.LibraryManagedAttributes<
      C,
      P
    >
  }
}

export {}
