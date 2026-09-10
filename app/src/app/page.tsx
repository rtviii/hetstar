import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">hetstar</h1>
      <p className="mt-2 text-neutral-600">
        Dynamic PDB heterogeneity viewer. Multiconformer models, per-residue metrics, and
        experimental density on stock Mol*.
      </p>
      <ul className="mt-8 space-y-2">
        <li>
          <Link className="text-blue-700 hover:underline" href="/compare-lab">
            /compare-lab
          </Link>{" "}
          <span className="text-neutral-500">
            — two models of one entry against their shared maps: qFit multiconformer vs
            deposited, carved 2Fo-Fc / Fo-Fc density, per-residue metrics painted onto the
            surface, conformer track and slice viewer.
          </span>
        </li>
        <li>
          <Link className="text-blue-700 hover:underline" href="/density-lab">
            /density-lab
          </Link>{" "}
          <span className="text-neutral-500">
            — incremental density prototyping: one capability at a time. Currently: carved
            2Fo-Fc / Fo-Fc hugging the model, live sigma contour.
          </span>
        </li>
      </ul>
    </main>
  );
}
