/** KaTeX macros that cover the common physics commands Typora accepts. */
export const PHYSICS_MACROS = {
    "\\dd": "\\mathrm{d}",
    "\\dv": "\\frac{\\mathrm{d}#1}{\\mathrm{d}#2}",
    "\\pdv": "\\frac{\\partial #1}{\\partial #2}",
    "\\qty": "\\left(#1\\right)",
    "\\abs": "\\left|#1\\right|",
    "\\norm": "\\left\\lVert#1\\right\\rVert",
    "\\vb": "\\mathbf{#1}",
    "\\vu": "\\hat{\\mathbf{#1}}",
    "\\va": "\\boldsymbol{#1}",
    "\\ket": "\\left|#1\\right\\rangle",
    "\\bra": "\\left\\langle#1\\right|",
    "\\braket": "\\left\\langle#1\\middle|#2\\right\\rangle",
    "\\grad": "\\nabla",
    "\\curl": "\\nabla\\times",
    "\\div": "\\nabla\\cdot",
    "\\laplacian": "\\nabla^2",
    "\\tr": "\\operatorname{tr}"
};
