2026-09-08 

Model
The model fields distinguish depositor assertions about an interpretation from quantities that Dynamic PDB can reproducibly calculate from its coordinate artifact.
Model should contain all fields as Entry plus these additional fields or changes. 
name
Definition: Human-readable name of the structural model or analysis.
Population: Depositor supplied for new models; inherited/derived for archive imports
Source: Depositor or PDB
Example: qFit 3.2 multiconformer
description
Definition: Free-text description of the structural interpretation.
Population: Depositor supplied or inherited
Source: Depositor or PDB
Example: Multiconformer rebuild of 2OU8 with default qFit settings.
model_type
Definition: Type of structural representation.
Population: Depositor supplied or inferred/validated from coordinates
Source: Depositor or coordinate artifact
Example: Multiconformer
Allowed values: Single Conformer, Multiconformer, Ensemble
purpose
Definition: Purpose for which the model was generated.
Population: Depositor supplied or inferred from run context. Should be defined dictionary list.
Source: Depositor/run provenance
Example: Refinement
coordinates
Definition: Primary L2 coordinate artifact representing the model revision.
Population: Depositor selected or linked automatically from run output
Source: Deposited artifact/run output
Example: qfit_2ou8.cif
authors
Definition: People responsible for the model.
Population: Inherited when available; otherwise depositor supplied
Source: PDB/mmCIF, uploaded file, or depositor
Example: Wankowicz, S.A.; Fraser, J.S.
atom_count
Definition: Number of non-hydrogen atoms in the model.
Population: Registry computed
Source: L2 coordinate artifact
Example: 1642
modeled_residues
Definition: Number of polymer residues represented by coordinates.
Population: Registry computed
Source: L2 coordinate artifact
Example: 214
unique_protein_chains
Definition: Number of distinct protein chains represented in the model.
Population: Registry computed
Source: L2 coordinate artifact
Example: 1
Altloc_fraction (https://github.com/ExcitedStates/qfit-3.0/blob/main/scripts/post/b_factor.py) 
Definition: Fraction of modeled residues containing alternate positions.
Population: Registry computed
Source: L2 coordinate artifact
Example: 0.31
unmodeled_fraction
Definition: Fraction of deposited polymer sequence lacking modeled coordinates.
Population: Registry computed
Source: L2 coordinate artifact plus deposited sequence
Example: 0.04
SW:  should be able to make one from Claude to compare AA sequence of FASTA v. AA sequence in PDB.
ligands
Definition: Bound small molecules of interest, represented by PDB Chemical Component Dictionary (CCD) identifiers.
Population:  derived/extracted from model and per model, can change with models
Source: PDB/mmCIF
Example: AP5
cofactors
Definition: Bound catalytic or structural metals and cofactors, represented by CCD identifiers.
Population: derived from model and per model, can change with models
Source: PDB/mmCIF, normalized against PDB CCD
Example: MG
Run
Run provenance should describe an actual software execution rather than duplicate information about the model. The authoritative schema explicitly treats runs as provenance records.
name
Definition: Human-readable identifier for the execution.
Population: Depositor supplied
Source: Depositor
Example: qfit-multiconformer-2ou8
software_name
Definition: Software package used in the run, preferably linked to a canonical software identifier.
Population: Extracted or depositor supplied, then normalized
Source: Run log, depositor, bio.tools, or RRID
Example: qFit, bio.tools:qfit
software_version
Definition: Exact version of the software used.
Population: Extracted from run provenance or depositor supplied
Source: Run log or depositor
Example: 3.2.2
command
Definition: Command used to execute the software, with identifying absolute paths removed.
Population: Extracted or depositor supplied
Source: Run log or depositor
Example: qfit_protein 2ou8.mtz 2ou8.cif -p 8
parameters
Definition: Structured set of software parameters used during execution.
Population: Extracted or depositor supplied
Source: Run log or depositor
Example: { nconf: 5, threshold: 0.20 }
inputs
Definition: Explicit references to artifacts consumed by the run.
Population: Depositor linked and/or registry reconstructed from execution provenance
Source: Dynamic PDB artifact relationships
Example: 2ou8.mtz, 2ou8.cif
outputs
Definition: Explicit references to artifacts produced by the run.
Population: Depositor linked and/or registry detected
Source: Dynamic PDB artifact relationships
Example: qfit_2ou8_unrefined.cif, qfit.log
metadata
Definition: Execution-specific facts that are neither software parameters nor scientific assertions.
Population: Extracted or depositor supplied
Source: Run log or depositor Example: { host: hpc-node-14, job: 88213 }


Model metrics
Metrics should be modeled as repeated key + value + provenance records rather than hard-coded database columns. Every present metric retains the software that produced it.
r_work
Definition: Agreement between the structural model and data used during refinement.
Population: Inherited from validation/refinement output
Source: Refinement software/run
Example: 0.176
r_free
Definition: Agreement between the structural model and a held-out validation subset.
Population: Inherited from validation/refinement output
Source: Refinement software/run
Example: 0.219
clashscore
Definition: Severe steric overlaps per 1,000 atoms.
Population: Inherited from validation output
Source: Validation software, such as MolProbity
Example: 4.8
Molprobity_score 
https://cctbx.github.io/mmtbx/mmtbx.validation.molprobity.html
Definition: Composite structural geometry validation score.
Population: Inherited from validation output
Source: MolProbity
Example: 1.61
Rscc
https://github.com/ExcitedStates/qfit-3.0/blob/main/scripts/post/compare_rscc_voxel.py
Definition: Real-space correlation coefficient between the model and experimental density.
Population: Inherited/computed by validation software
Source: Validation run
Example: 0.97
Residue data
Residue records are optional, model-revision-specific records. Most residue identity fields should come directly from the coordinate artifact rather than be re-entered by a depositor.
SW Comment: Most of these should be easy claude scripts from mmcif file
label_asym_id
Definition: Machine-stable mmCIF chain identifier.
Population: Extracted
Source: PDBx/mmCIF coordinate artifact
Example: A
label_seq_id
Definition: Gapless mmCIF polymer sequence position.
Population: Extracted
Source: PDBx/mmCIF
Example: 52
label_comp_id
Definition: Chemical component identifier for the residue.
Population: Extracted
Source: PDBx/mmCIF, interpreted against PDB CCD
Example: ILE
auth_asym_id
Definition: Author-assigned chain identifier.
Population: Inherited/extracted
Source: PDBx/mmCIF
Example: A
auth_seq_id
Definition: Author-assigned residue number.
Population: Inherited/extracted
Source: PDBx/mmCIF
Example: 52
pdbx_pdb_ins_code
Definition: Insertion code associated with author residue numbering.
Population: Inherited/extracted
Source: PDBx/mmCIF
Example: A, or absent
label_alt_id
Definition: Alternate-conformation identifier for conformer-specific values.
Population: Extracted
Source: PDBx/mmCIF
Example: A
uniprot_position
Definition: Corresponding UniProt position calculated through the stored polymer-entity mapping.
Population: Registry computed
Source: Polymer entity mapping plus label_seq_id
Example: P69441:52
rscc
https://github.com/ExcitedStates/qfit-3.0/blob/main/scripts/post/compare_rscc_voxel.py
Definition: Residue-level real-space correlation coefficient.
Population: Computed/inherited from validation
Source: Validation software
Example: 0.97
B_iso
https://github.com/ExcitedStates/qfit-3.0/blob/main/scripts/post/b_factor.py
Definition: Mean isotropic displacement parameter for atoms in the residue.
Population: Registry computed from coordinates
Source: L2 coordinate artifact
Example: 18.4
occupancy
Definition: Occupancy associated with the specified alternate conformer.
Population: Extracted
Source: PDBx/mmCIF coordinate artifact
Example: 0.6
Conformer_count
https://github.com/ExcitedStates/qfit-3.0/blob/main/scripts/post/b_factor.py
Definition: Number of modeled conformations for the residue.
Population: Registry computed
Source: L2 coordinate artifact
Example: 2
Rmsf
for multiconf: https://github.com/ExcitedStates/qfit-3.0/blob/main/scripts/post/qfit_RMSF.py
Definition: Root-mean-square fluctuation across ensemble members.
Population: Registry computed
Source: Ensemble or trajectory
Example: 1.2 Å



Navigation
Background and context
Definitions 
To add (key page)
Do not include
Next steps 



General Adds
A way to version our data dictionary/metadata/schema
Should be readable on GitHub for community analysis and comment 
Introduce a persistent identifier for entries by appending DPDB to the PDB identifier, ex: DPDB-####. 
The PDB currently uses: 7HHU | pdb_00007hhu but it is sunsetting the 4-character alphanumeric code. 
When no PDB deposition is available, a persistent identifier should be generated such that no duplicates are made. 
Metadata is inherited or initialized from PDB metadata when appropriate; otherwise depositor supplied

Entry pages and model pages are separate (as currently is on the dynamicpdb.com) but links back and forth and relationships should be prominent and visible. 

Entry: Metadata fields that should be visible on the Entry Page 
Name
Definition: Human-readable name of the experiment or dataset.
Population: Inherited or initialized from PDB metadata when appropriate; otherwise depositor supplied
Source: PDB and/or depositor
Example: Adenylate kinase, apo
Description
Definition: Free-text description of the experimental context.
Population: May be initialized from PDB metadata; depositor may supplement or provide Dynamic PDB-specific context
Source: PDB and/or depositor
Example: Apo form collected at 277 K to compare ambient-temperature heterogeneity against the cryo structure.
PDB
Definition: PDB accession associated with the experiment.
Population: Depositor supplied or established through imported PDB data; registry validated
Source: PDB
Example: 2OU8
Method
Definition: Experimental method used to generate the underlying experimental data.
Population: Inherited from PDB/mmCIF when available; otherwise depositor supplied
Source: PDB/mmCIF or depositor; normalized to an appropriate controlled vocabulary
Example: X-ray diffraction
Organism
Definition: Organism from which the biological sample originated.
Population: Inherited from PDB/mmCIF when available; otherwise depositor supplied
Source: PDB/mmCIF or depositor; normalized against NCBI Taxonomy
Example: Escherichia coli (NCBITaxon:562)
Resolution
Definition: Highest measured experimental resolution in ångströms, where applicable.
Population: Inherited from PDB/mmCIF when available; otherwise extracted from deposited experimental data or depositor supplied
Source: PDB/mmCIF, experimental artifact, or depositor
Example: 1.85 Å
Space_group
Definition: Crystallographic space group in Hermann-Mauguin notation.
Population: Inherited from PDB/mmCIF when available; otherwise extracted or depositor supplied
Source: PDB/mmCIF, experimental artifact, or depositor
Example: P 21 21 21
Temperature
Definition: Experimental temperature in kelvin.
Population: Inherited from PDB/mmCIF when available; otherwise depositor supplied
Source: PDB/mmCIF or depositor
Example: 277 K
pH
Definition: Sample or crystallization pH associated with the experiment.
Population: Inherited from PDB/mmCIF when available; otherwise depositor supplied
Source: PDB/mmCIF or depositor
Example: 7.4
Ligands
Definition: Bound small molecules of interest represented by PDB Chemical Component Dictionary identifiers.
Population: Inherited or extracted from PDB/mmCIF when available; depositor may supplement. Can be derived/extracted from model and per model, can change with models
Source: PDB/mmCIF, PDB CCD, and/or depositor
Example: AP5
Cofactors
Definition: Bound catalytic or structural metals and cofactors.
Population: Inherited or extracted from PDB/mmCIF when available; depositor may supplement. Can be derived/extracted from model and per model, can change with models
Source: PDB, PDB CCD, and/or depositor
Example: MG
Construct
Definition: Description of tags, truncations, fusion partners, mutations, and reference-sequence context relevant to the expressed construct.
Population: Inherited from PDB/mmCIF construct and entity metadata when available; otherwise depositor supplied or supplemented
Source: PDB and/or depositor
Example: His6 tag, TEV site; reference UniProt P69441
Mutations
Definition: Sequence changes relative to the stated reference sequence.
Population: Inherited or derived from PDB/mmCIF sequence/reference mappings when available; otherwise depositor supplied
Source: PDB/mmCIF, reference-sequence mapping, and/or depositor
Example: A123G
Uniprot
Definition: Associated UniProt accession or accessions.
Population: Inherited from PDB/SIFTS mappings when available; otherwise computationally mapped or depositor supplied and validated
Source: SIFTS, PDB/mmCIF _struct_ref, UniProtKB, or depositor
Example: P69441
Artifacts
The Deposit interface treats artifacts as independently identifiable files or external objects, with metadata coming from both the depositor and registry inspection. They should be tightly linked with easily identifiable provenance. 
level
Definition: Dynamic PDB structural level assigned to the artifact.
Population: Depositor supplied with registry validation/detection
Source: Dynamic PDB classification
Example: L2
name
Definition: Artifact filename or human-readable artifact name.
Population: Depositor supplied or inherited from source
Source: Uploaded file, external source, or depositor
Example: 2ou8.cif
format
Definition: File or object format.
Population: Registry extracted/detected; depositor declaration may assist
Source: Artifact
Example: mmcif
size_bytes
Definition: Size of the artifact in bytes when known.
Population: Registry computed
Source: Artifact
Example: 318552
sha256
Definition: SHA-256 digest of artifact bytes held by Dynamic PDB.
Population: Registry computed only
Source: Dynamic PDB
Example: ###########...
Polymer entity to UniProt mapping
These fields represent the interoperability boundary between deposited polymer entities and UniProt rather than duplicating UniProt annotations locally.
accession
Definition: UniProtKB accession corresponding to the polymer entity.
Population: Inherited or computationally mapped
Source: SIFTS, mmCIF struct_ref, or alignment against UniProtKB
Example: P69441
label_entity_id
Definition: mmCIF _entity.id identifying the polymer entity in the coordinate data.
Population: Extracted
Source: PDBx/mmCIF coordinate file
Example: 1
source
Definition: Method by which the UniProt mapping was established.
Population: Registry recorded from mapping process
Source: Dynamic PDB provenance
Example: sifts
Allowed values: sifts, struct_ref, alignment
unp_release
Definition: UniProtKB release against which the mapping was established.
Population: Inherited/recorded automatically
Source: UniProtKB
Example: 2026_03
identity
Definition: Fraction of identical residues for mappings generated by sequence alignment.
Population: Registry computed
Source: Alignment run
Example: 0.98
alignment_run_id
Definition: Identifier of the reproducible sequence-alignment run that generated an alignment-based mapping.
Population: Registry assigned
Source: Dynamic PDB
Example: similarity_run_...
unp_begin / unp_end
Definition: Inclusive UniProt coordinates for a mapping segment.
Population: Inherited or computed from mapping source
Source: SIFTS, struct_ref, or alignment
Example: 1 to 214
seq_begin / seq_end
Definition: Corresponding inclusive coordinates in the deposited polymer entity.
Population: Inherited or computed from mapping source
Source: SIFTS, struct_ref, or alignment
Example: 1 to 214
Model
The model fields distinguish depositor assertions about an interpretation from quantities that Dynamic PDB can reproducibly calculate from its coordinate artifact.
Model should contain all fields as Entry plus these additional fields or changes. 
name
Definition: Human-readable name of the structural model or analysis.
Population: Depositor supplied for new models; inherited/derived for archive imports
Source: Depositor or PDB
Example: qFit 3.2 multiconformer
description
Definition: Free-text description of the structural interpretation.
Population: Depositor supplied or inherited
Source: Depositor or PDB
Example: Multiconformer rebuild of 2OU8 with default qFit settings.
model_type
Definition: Type of structural representation.
Population: Depositor supplied or inferred/validated from coordinates
Source: Depositor or coordinate artifact
Example: Multiconformer
Allowed values: Single Conformer, Multiconformer, Ensemble
purpose
Definition: Purpose for which the model was generated.
Population: Depositor supplied or inferred from run context. Should be defined dictionary list.
Source: Depositor/run provenance
Example: Refinement
coordinates
Definition: Primary L2 coordinate artifact representing the model revision.
Population: Depositor selected or linked automatically from run output
Source: Deposited artifact/run output
Example: qfit_2ou8.cif
authors
Definition: People responsible for the model.
Population: Inherited when available; otherwise depositor supplied
Source: PDB/mmCIF, uploaded file, or depositor
Example: Wankowicz, S.A.; Fraser, J.S.
atom_count
Definition: Number of non-hydrogen atoms in the model.
Population: Registry computed
Source: L2 coordinate artifact
Example: 1642
modeled_residues
Definition: Number of polymer residues represented by coordinates.
Population: Registry computed
Source: L2 coordinate artifact
Example: 214
unique_protein_chains
Definition: Number of distinct protein chains represented in the model.
Population: Registry computed
Source: L2 coordinate artifact
Example: 1
Altloc_fraction (https://github.com/ExcitedStates/qfit-3.0/blob/main/scripts/post/b_factor.py) 
Definition: Fraction of modeled residues containing alternate positions.
Population: Registry computed
Source: L2 coordinate artifact
Example: 0.31
unmodeled_fraction
Definition: Fraction of deposited polymer sequence lacking modeled coordinates.
Population: Registry computed
Source: L2 coordinate artifact plus deposited sequence
Example: 0.04
ligands
Definition: Bound small molecules of interest, represented by PDB Chemical Component Dictionary (CCD) identifiers.
Population:  derived/extracted from model and per model, can change with models
Source: PDB/mmCIF
Example: AP5
cofactors
Definition: Bound catalytic or structural metals and cofactors, represented by CCD identifiers.
Population: derived from model and per model, can change with models
Source: PDB/mmCIF, normalized against PDB CCD
Example: MG
Run
Run provenance should describe an actual software execution rather than duplicate information about the model. The authoritative schema explicitly treats runs as provenance records.
name
Definition: Human-readable identifier for the execution.
Population: Depositor supplied
Source: Depositor
Example: qfit-multiconformer-2ou8
software_name
Definition: Software package used in the run, preferably linked to a canonical software identifier.
Population: Extracted or depositor supplied, then normalized
Source: Run log, depositor, bio.tools, or RRID
Example: qFit, bio.tools:qfit
software_version
Definition: Exact version of the software used.
Population: Extracted from run provenance or depositor supplied
Source: Run log or depositor
Example: 3.2.2
command
Definition: Command used to execute the software, with identifying absolute paths removed.
Population: Extracted or depositor supplied
Source: Run log or depositor
Example: qfit_protein 2ou8.mtz 2ou8.cif -p 8
parameters
Definition: Structured set of software parameters used during execution.
Population: Extracted or depositor supplied
Source: Run log or depositor
Example: { nconf: 5, threshold: 0.20 }
inputs
Definition: Explicit references to artifacts consumed by the run.
Population: Depositor linked and/or registry reconstructed from execution provenance
Source: Dynamic PDB artifact relationships
Example: 2ou8.mtz, 2ou8.cif
outputs
Definition: Explicit references to artifacts produced by the run.
Population: Depositor linked and/or registry detected
Source: Dynamic PDB artifact relationships
Example: qfit_2ou8_unrefined.cif, qfit.log
metadata
Definition: Execution-specific facts that are neither software parameters nor scientific assertions.
Population: Extracted or depositor supplied
Source: Run log or depositor
Example: { host: hpc-node-14, job: 88213 }

Model metrics
Metrics should be modeled as repeated key + value + provenance records rather than hard-coded database columns. Every present metric retains the software that produced it.
r_work
Definition: Agreement between the structural model and data used during refinement.
Population: Inherited from validation/refinement output
Source: Refinement software/run
Example: 0.176
r_free
Definition: Agreement between the structural model and a held-out validation subset.
Population: Inherited from validation/refinement output
Source: Refinement software/run
Example: 0.219
clashscore
Definition: Severe steric overlaps per 1,000 atoms.
Population: Inherited from validation output
Source: Validation software, such as MolProbity
Example: 4.8
molprobity_score
Definition: Composite structural geometry validation score.
Population: Inherited from validation output
Source: MolProbity
Example: 1.61
rscc
Definition: Real-space correlation coefficient between the model and experimental density.
Population: Inherited/computed by validation software
Source: Validation run
Example: 0.97
Residue data
Residue records are optional, model-revision-specific records. Most residue identity fields should come directly from the coordinate artifact rather than be re-entered by a depositor.
label_asym_id
Definition: Machine-stable mmCIF chain identifier.
Population: Extracted
Source: PDBx/mmCIF coordinate artifact
Example: A
label_seq_id
Definition: Gapless mmCIF polymer sequence position.
Population: Extracted
Source: PDBx/mmCIF
Example: 52
label_comp_id
Definition: Chemical component identifier for the residue.
Population: Extracted
Source: PDBx/mmCIF, interpreted against PDB CCD
Example: ILE
auth_asym_id
Definition: Author-assigned chain identifier.
Population: Inherited/extracted
Source: PDBx/mmCIF
Example: A
auth_seq_id
Definition: Author-assigned residue number.
Population: Inherited/extracted
Source: PDBx/mmCIF
Example: 52
pdbx_pdb_ins_code
Definition: Insertion code associated with author residue numbering.
Population: Inherited/extracted
Source: PDBx/mmCIF
Example: A, or absent
label_alt_id
Definition: Alternate-conformation identifier for conformer-specific values.
Population: Extracted
Source: PDBx/mmCIF
Example: A
uniprot_position
Definition: Corresponding UniProt position calculated through the stored polymer-entity mapping.
Population: Registry computed
Source: Polymer entity mapping plus label_seq_id
Example: P69441:52
rscc
Definition: Residue-level real-space correlation coefficient.
Population: Computed/inherited from validation
Source: Validation software
Example: 0.97
b_iso
Definition: Mean isotropic displacement parameter for atoms in the residue.
Population: Registry computed from coordinates
Source: L2 coordinate artifact
Example: 18.4
occupancy
Definition: Occupancy associated with the specified alternate conformer.
Population: Extracted
Source: PDBx/mmCIF coordinate artifact
Example: 0.6
conformer_count
Definition: Number of modeled conformations for the residue.
Population: Registry computed
Source: L2 coordinate artifact
Example: 2
rmsf
Definition: Root-mean-square fluctuation across ensemble members.
Population: Registry computed
Source: Ensemble or trajectory
Example: 1.2 Å


Appendix: non-comprehensive annotation of useful information on PDB entry page 
PDB Entry UX Anatomy 




Anatomy of PDB entry landing page. Highlighted items are important for current Phase (most already in place) 



Navigation
Background and context
Definitions 
To add (key page)
Do not include
Next steps 



