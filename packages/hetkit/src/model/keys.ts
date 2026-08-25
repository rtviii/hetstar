// Auth-keyed residue identity. qFit output, _pdbx_alt_groups selectors, and the
// dynamic-pdb UI all address residues by auth chain / auth seq id, so that is
// the canonical key throughout the package.
export interface ResidueRef {
  chain: string;
  seq: number;
  ins: string;
}

export function residueKey(r: ResidueRef): string {
  return `${r.chain}|${r.seq}|${r.ins}`;
}

export function atomKey(chain: string, seq: number, ins: string, alt: string, atom: string): string {
  return `${chain}|${seq}|${ins}|${alt}|${atom}`;
}
