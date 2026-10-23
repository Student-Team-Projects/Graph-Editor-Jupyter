// Cytoscape caches where its canvas is on the page to turn mouse coordinates into graph
// coordinates. It clears that cache when an ancestor scrolls, but finds the ancestors once, at
// start-up, and our widget starts before Jupyter puts it on the page. So after the notebook
// scrolled, clicks landed in the wrong place and the graph seemed dead (until something called
// cy.resize(), such as turning force off). Kept free of DOM code so it can be tested in Node.

interface WithRenderer {
  resize(): unknown;
  renderer?: () => { invalidateContainerClientCoordsCache?: () => void } | null;
}

// Forgets the cached canvas position; the next mouse event measures it again.
export function forgetPageOffset(cy: WithRenderer): void {
  const renderer = cy.renderer?.();
  if (renderer?.invalidateContainerClientCoordsCache) renderer.invalidateContainerClientCoordsCache();
  else cy.resize(); // public fallback in case a Cytoscape update renames the internal method
}
