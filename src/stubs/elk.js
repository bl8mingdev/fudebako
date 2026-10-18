// Fudebako ships without elkjs (EPL-2.0) to keep the bundle small and permissively licensed.
// Mermaid only needs it for the optional `layout: elk` renderer; every default layout still works.
export default class ELK {
  layout() {
    return Promise.reject(new Error('The ELK layout engine is not included in Fudebako. Remove "layout: elk" to use the default layout.'));
  }
}
