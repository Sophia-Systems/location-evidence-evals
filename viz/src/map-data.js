// map-data.js -- GENERATED, do not edit by hand. Regenerate with:
//   node viz/tools/make-map-data.mjs
//
// Source: Natural Earth (public domain), https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_coastline.geojson
//         and https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_boundary_lines_land.geojson
// Pipeline: each vertex projected with project() from viz/src/geo.js
// (azimuthal equidistant, center 54N 13E), clipped to x,y in
// [-1350, 1350] km, Douglas-Peucker simplified at 2.5 km,
// quantized to 0.1 km integer units, fragments under 8 km dropped.
//
// Encoding: per polyline, a Google-polyline-style string -- signed integer
// deltas of the quantized (x, y) pairs, zigzag-encoded, 5 bits per char,
// char codes 63..126. decodePolylines() returns km on the display plane.
// Generated 2026-08-20.

export const COAST = [
  "{fJ}xIxH~@jDk@lFfCn@hDrBAvA`BdB{@|Cp@mD`F|BlEk@rAaK~DzD|J_@jCkDgBmA}LeBkC{KwAgKeO}EaAnMwG",
  "svEcwG\\xCfB{@rExAjLbSIzRwFpKjCtJ_FqCeCgL{FeEoAmGkC_BzCoDLoN}GyH|E}CbAd@",
  "~c@ccA[uM{KuE^{EtEuDe@_D}KaIt@gOiB}F`JiE~BDzLhIsA`DvCtL~CgAMmKpAmB~DXfEbLnLx@a@jDiCbBmAnH^nHkCtGoMp@cB|QuC~HsF{A_@eJ",
  "~vAcoAw@aLdEgSrDlBlG_C~O|DP~IqCtLuPrGgF?qEkD",
  "daFbrX_Bv@BrBrCpFeEVWzBpA`F",
  "`{DvjYSeHyG}NJgZhBoFm@kUhA}AtABz@`DDhKxAzCpFaBbDtCjPxEjGzKkDnDzDdCoBdF",
  "~qRydIiVkBsKpDkb@zDcExFc@bI~JvKzM|WlKlLrGxE|XvCmOl@oFjFx@fChCtAbGi@bPzF~MmGqD~EaSjHgHeB_H~@gNhK{LvYcCp}@kRbQiQ|]`EtDuFt]fFyBvE{FzNeAkM`DgMpQcCbIi@tKzNbNmGlGmCK_HmGkSbCwKvE{HlJSdSjI~UzGjFnC|@lBs@K~GbCfAxH_AnH|BuDxBt@`GbTxBuCQqD|FkGjBqUnBvAhKvOvE`DvF~F}@pYjF`PwEvXm@jXmMmA|DxGjBnUcBq@hFnB^`LgDdCx@dLqIjH{AtQt@`Q|V`DMtMkNtWf@jMtDxEbFzCApF_G`Hn@@{DyCmBuIWyQaLmDm@iPaL}D_LmI_@gFyHiNTq\\xGyd@y\\lN~FpIRrN`F~IiC|IkNxM_AoFuCjFmBrBcD~G_AnMhC|FwFLkJfA}@gH}Ds_@gEyJiEoI}K~AoDgBcEh@sGgAiEtIk@xMxAgBgDqJ}DuFoFeTcEaO`@eCP{F`GRyHqCg@_CrH}Ef@~DgCrBmKk@}CuFwGrBwBQ}Cu@_C}DqAsCmMrKPlIyYUyEkG}KyHgFwHa@`SkCrQlFxEq@pBwDvJlBbI}GjErHvDsL[aHsAe@}@fAqV}]B_FpCoG{BsJqByBkGfAxFcIqByE`FpF|Eb@|ElDmBaKoJaHxR|JdBlNjL|VrChB|BuBcGwO}HeIfC}@kJs[cUw]hTpIfFcCl@uHnDsBiP}CzBuCsLwIoBoGnDgOmBsBeFm@|BcGcEkJcBiBwJn@iCzArDeNwDsIcKn@T_HiB}GiCeBuD~@eAbD{G{@a@fCsj@^_FvAvDzM~C`Dv`@xPnBxEyDzBjIrFtBdEiD`@",
  "vjYmbDqEyFpE[",
  "vjYm|DkAi@cA}GeF_FeJCoHrBYiC}Cx@YpDxC`Fa@nAtBxAiBUaDiAqA}LgH]f@{CiAHsInK`IjCrAnAYxAcE@eD{DcRf@wKhDiC`VaCfGZdCxFbBXzA{Jr@s@jGx@tFhDiHnAnJuBv@vBbEfHD~IhIbFuCa@nD|FAKz\\hCbMbB~]fHbJpDrKzF`GzDnAyBdGvId@rG_ClDbAh@}EdDrD",
  "bxGzU_Ey@|EN]h@",
  "blHbTfAFgJt@~G}@",
  "jiIj\\zCvCgGgCjBO",
  "lxHvUpHv@oOo@|EG",
  "qjE`{VyIB~C_BvUa@yCpDwD\\kEqA",
  "kqErmVqB]nXaAfAsAzEWhFl@uNpDuUS",
  "qwDhdVnI}Aa@{CuRp@_BjAfDhB~FP",
  "||TlmFyBrBoAcChEN",
  "~lTh_G~@~DcIx@IoBlGiC",
  "w_EehJh@vCkCaE`Bh@",
  "aeEshKb@xF_CmEzAk@",
  "qpI}gJsBbIuAd@cC}@sAeGcBrAkDwCbDkIvEUlBqCnDtGdM`CmLxB",
  "imJ__J|AdDyFxB{Ac@l@wEhEc@",
  "|{TybBiC}C^eI|LrH`EjHqEtAcIqE",
  "z`Va`H`DnCiG{BfBS",
  "n~TugE\\uGtCqAnCjDDzHaGnCgAoG",
  "nhUaoGzB}@rBcHlFJ~@vBcD|DfCnGpC?j@|AySbAkBuHdA{A",
  "p~UgjFfG`BbAu@nChBdBbFcH{AzB|IcJgBu@sO",
  "huU_pFbAfBy@x@nFxBNbEyAF{M_QjHvA",
  "t{MacO`ClFw@rFgD_K|AaB",
  "zcNatN~@Zs@uH|BExE~DuBrAOxHnIh@ChBqC`ABjBqDBQrAvD`Om@rAsOyc@|B`@r@eD",
  "fsMw~NkBsFd@mAjBXt@fCCfCwAV",
  "fbQixKvAs@dAbAsCjGqA[fA_G",
  "`eUwm@tIOp@tGcDlI}NmGhCYnCkH",
  "dbPkmLpD~B}BZ}DkBhCo@",
  "j{PupKmAjEqAqD~CY",
  "dqPwyKlGsBgAgE`BkBlD]tBnHe@t@uAu@GjDkFVeDnCgBuBp@gA",
  "h|Ru}RdEqC}C~Ig@mE",
  "`eSseRKiDzCcEPbFeC`I[wD",
  "hnSwrSoDfCgCc@tByE~Da@@vC",
  "nbSopSaEfKDiKgDlBqBwGjG_HfF@]hM",
  "nqPynLaBvAGbEkB_@SwApEcI~A\\gA`C",
  "doRoqS_BkCtA{FxAvGoAnB",
  "btUgqJgSwHFwBbCi@}HaC{FmIi@yHxU`GN`GvDg@lBkCpBjAv@~EsAxAnBlAoDlFfI~CgBpDeD_C",
  "|tUqvH}@dDsA?AgErC`@",
  "bnUsdImApCwGf@f@`J_NaHPgBlEi@fGaEcCqQjBgFzBzBjHHC`CpCO`B~Ao@dEuFxCc@zE",
  "ncVkkJ`IYrA|AoDrE}Cn@cDgDzA_D",
  "zlVixIbCa@nB`IP`FyAjA}@UmBwP",
  "t|VqaIN|BoC_@h@_BtA@",
  "spHaoMk@YxCcCO`EkEjAlBoB",
  "aaFu{LTfCmAdBmA{Bp@}BrAJ",
  "ksF}yLeCM[kEvDiC|CDfAcBbAh@aArJbATT}ChB~BmB~G_ISS_F",
  "aeGwrS|BdBFyBvCPkE`GuCwBbAgC",
  "}`Fs}G`BbD}BfBGkCeEkBhFS",
  "}sCceFnFtWpB|@fFvT{@pUqBmBaOwdAkA{ApBq@~@tE",
  "{dA_zA|ArLyMjE}AyHxMeI",
  "iWs\\eAkHvEyBvAyDnBBjEtIQdNcFnDuCkEsCCqC|B?aFjC{A",
  "nZogAj@s@hEjIqAp@_FwCsFGbBsBjEu@",
  "xQgoBe@`CoCyAv@wD|BnC",
  "tt@my@xCD~IwG~FPf@rJuOlIoKgB\\}GdB{@",
  "~hB}_AtDeCiDlF_Br@qBo@dEkB",
  "`_CglAOjJcIx@dAaFlGcE",
  "fyAicAzCpFmAlFiJg[zGfL",
  "r_Bu|BmAj@_BuFbCcGh@lM",
  "dlAce@bBrCuCpBeE@x@{D|DkA",
  "plAafFjAbBcDlAiEiE`HV",
  "|sDenAx@K`DdIb@vH{AmDoJiA|He@qBsI",
  "|rTdcNBzDmDxJyAuDbG_K",
  "fpRp`DhKdDaIpF}CD{EaDpH{F",
  "~vIbj@t@tB}AzAuCmC[wFxErD",
  "lfCleWzK`A_@`BoI]eCnBWkFr@wA|@lA",
  "}nB|oTlGkEiHxGZmA",
  "utA|jRnG}IjE|GoKtHaEu@tB_E",
  "a{AbcSfD{GdBENlD}GrB",
  "g~A~rSyKzJwB}AjXmVyGnM",
  "{`BnlTlCkBaMvPiBP|K}M",
  "mvB~yTgB\\tGmFmDnE",
  "wgAxbSH_P|EkLfAl@{ArGf@hGuGfRXgF",
  "c`FxbWfAT{S~ChFiChJk@",
  "pcKlcCxEi@bC~@_IbFoD[pC}E",
  "|rDqy@pC|AyDdAg@eCnA]",
  "``GtM|CxAyBB_BwAz@E",
  "w_IqeMaBsDrAkBfEEpAfEkFnFoBMnAcC",
  "cwGuzM_CfGsCYAgBbFwEp@pA",
  "mmHaaMv@bAq@lCsBeFlBR",
  "meGgsLtDtAgFZp@qB",
  "giHm~LdC~@s@hB}Aa@JgC",
  "kxIu_XpD`C[jCwBXuFaFvEeA",
  "poGccO`BlFiA^aBO_@iChBsB",
  "fxCmmSo@mEv@{AtGhBiAnCsEn@",
  "dkCocT}H{@FaFfNdFqDv@",
  "|Mm_Yj@lD_IkEzBe@vCbA",
  "~NwjYbBbFcFkAi@oB",
  "fv@qzVpHjBfArB}KrAcAyCfByC",
  "jtGaaMcCfCd@qQlAnANxJ",
  "p\\mlX~Cb@VnDoDm@GeD",
  "}gVwjY}BpE\\bErLdNr`@o@xI}HjLeElDg@|HrC|GwAnFiEv@qC",
  "eAwjYhGxAaF~HdEFrBnBdKbVpCfMIxDeGtEuMwIfDtGxE|F|DZfCoE~RvLfCxCx@lIaI{BhBvC`HhC|GxEdBtDfG~CrIdOdFlE~CfJbGdG^~FkDc@iCpK_CX}Z{OsBcD|BkDcDqCeF_CuBv@Yp@xG~E_Ct@y@~ChS|Jv@pCmAxExPElDdChHuOvJdBtDlFhA_BgAkEzGeClGrAdFrEQvBkEv@]|DtJ`BdClGeLzUjKgJ~A{EpOy@fExCtMdD|F|Li@n@aNgAaDfBsSqAk@zAbQvATfCaDbAh@l@fD`@hEuC~O_CtKTtGrIGvAiQmA~BzBjOlAdDeDzK~DzEjInB_BjBr@rA~Gm@`DkBz@wE@yStGwRT`HpB|MCdPmHrPWn@pJoEnKeDrCnJhA\\vKkArCsEhEeCZ{EkAuMB{HhBwBa@oC_Hk@|DgH~BwFHoBW_BaLaCaC|B`Hm@pDsEj@rRtEZpHr@iF|DqElKzAhMwBnOpArLsAdB|@j@~Uu@fDyB`DuMuEhRzMeBbPcC`CgG\\YfA`F|AzHkAjEfWUpEsLqJoG_KsEoBq@mD}HuKcFkCyUkC`IrDjGvP_BgMp@kBdMvInBbIjL`McBbDoLIxKrCzBtC`IwCjEfClH`[]pCwENcGyFkIgBcTmKvPpOFzFlBxDmEzIwHoAhIbGjOuJrCxKWfMsBdFoJpJmJpGyHh@]xArDnEc@|@}ClAeBwDuANMtDmBnBcF_@yHrAiN}AiEeCuCLwL{H}NyP}MoJ{A}B|AuB{KiFq@sArCkFyAE{EjJyGoCkBn@wHmQNuOeEoC^qFkAuCYbYgElMyQ`EUtA?`AfBqBpBN|@dEqAbj@_BUsBzAIjNmBfGuD`AYvPiDvAyAtPmBm@oBjN_IjUuDxDmDdJkEbBk@bFlAjCtFXoDfKtB~@~G{BkRvd@nBlVePlCcRyDoM~@mEgHtD{LKeFaLiNsF\\v@_FsA_AaTBoJyA}F|BgEaFcDqR{EyMqDgXtAsLwDuOtCmTc@aFsBOV{OkA{BbDaNsHqCfDcE|SqAqBaA}VQyKqHqBuDk[oRsB{K_FcBhCiDxKlFnDOTaAsIgEoUcWlAwKzDaHbHkCE_FlMuH~FaKxHnCvAgE~FM~B{BzFo{@oAwD\\uCaHdAzBkKaBcTuB{CbFsEfAyGYeB{FnByJiJrCwB_AmC`BiJu@pBqCOJdB_BCeAiCqEyBUqE~D?mEgDw@cGwFsAt@mB}EXmGoPuCfBH{DcFnA{CyIqGoCoNaOeDkUsJqN[}DjMmU}HoVnEsKiEbBjBiGsH{BCsFkEiAjAwB}CFq@yQqCbCiCwC",
  "mvGwjY_IlEyA_CiFmA",
  "kkIwjYmArBwPrD{B~By@nVcDnGlBxC}AzDjIDfItFvC~SdMd\\RtE`B\\tQnZnElBpAjJpAQm@dCbBTsBnGfKtGdBo@tFhByC|InDb@GxD`GvNmBjUuDhCaAbGd@nO{CtCcIjTdBdBwAlCz@D_A~LjAhUyDhXqEvB}DeDoA|DwMjDiJCn@dFeBfBjCrD}@tGsHiBmAoJq@F_CdFyFfC`EtMaAJgDwAgGgJaH@oSuGwBXeCgF_QwGgNuKgCzBkDsEaBElCqGiH~AqDkAuB}Mw@tMuSqLwHpBkUoKmHwHsDlB_@hGbDgAuF~HiPbH{TqDoJfHyF~AKvBRjAbb@M~BfLlE`BnGc@vBbKlGyClAZRdCiCfJvBxIh_@fCpLqCtf@p@k@jDdAbBtRlBlHhEfF?`ExFdC\\}@jDjIxAfH`FYjJ_A`AbAxD_CrGiEYpCvDD`CeGnHiCpHqLnCcCiAqA}EgFVt@ng@cHfc@bMhRdIdCvMcE~FgNvScOvCmG`\\rMxFjQn@pT|GrM?bLyFvw@wH|ViAdc@vJbBdKwBkMkZc@wQfAfNxIdU`ItJnJX`D|AtAjSrI|MzD|BbP`CxD]`FuB`J_TeNpE|@mBfQiHnHZl_@pHpMbI|KrBfM`R`c@xJnc@|NnDMlPiLAvC{BhCIdG_YjBi@vKfYwInBqB~DySfJ\\fKwHxC}GhQ_C~QrSzKl@lOrL~JyCrFVdCuDgGcFoAyEz@}EpJ`CvM_H`Ex@pAsDbJRyEiF?mEzCsFxDcAt@oLdHeBmHiNlA{NyP{PlC{DqCcAkE`@oGqYaAs@eClDeBAgHeEs@kCk@yDzAoDtLKtFgFq@iYgHsO_@gMdB_GsE}JjLzFbJ`AdTfZ|]rAxLdP`@vEeFvEyJoBqHuRqCu@kDnAlBlTpCuE~EtBfEbF`B~GfCwCbIsCnCJ|Bh_@kAbJpChYeQzL_@hQ|Bf@{ApI?nL}HfQNzCnKbCPbFoD]}C|Bd@`QwAhDmLlDeKrQcElB~FqBbIiNpCeBtKTfJmBbChE`BvYMkGbEwEhEtJrBwAwAaDvDuIpNq@rPp@rClEfBjKkD~EdH}BrDmGh^OxUhFnGdJjL~FrFxAtC{AbPhi@lRtRnF|JkG`NvF@oI~HxDJ|HqH|DgAlGStCvAcDvEuHlCgGi@_H`DdDd@~B_BzDdAhRiDfT`EdWnIxVv@zEvAtCzApDjH`El]i@dB|H|HbG~Ch\\rC|SrFzCzKaEhCiFPh@p@`L\\rMvCfN}E~YsFvAcGi@}KjCyAhITrJqBXrLgExTrChZkAdGaC~BnSsAvAiD~D|EnA_DnOyBtKdDdImSlHwDdJQlKlClNmBnUVxHhBhBrDOlEuMhByD~DhNwA}@xCgF`EzAfA~JB~ArAeIpF{AfJ}QnB{QnLyKbCgB|DgClAoGBcAdAzBvB[z@cIf@_DbD|D`DE~CoExB{Pn@oHtGjKuEhEfAbBtBqEhIxD`JoH|YkO`NcJ|C~AzYa@hLbGwB@~BiOtSoAhZmB~ExDuF|A}ShIyK|HlWbHj`@wDyDwAxD|C`@|CfErW|`A|GdFt\\dA|^gOrHxBhPsHjCgDzKQ",
  "jvQvjYoYeAqLsIwe@wNcMoISsHxBcEs@kEoFi@lGiU[uU}KyPy[cNeFeEiFe@wFzGyVdIaQ_BClDiKzAsBnGaLzCoEdEmNfByVuEmGmJg\\cSge@yHk\\y]}IuCwXpGkTdOuNhE{EhDsDl]aE`IkBvJXlOyHlAsChHwEvCoJnMWlDhCtA}@|@aGcAkIjCaFjDqGlM{L~HmC~D",
  "eeDvjYh@aElD_Anm@d@|NwF~b@{]`HqK|I_a@lKaZrL{FrRiOxIcDtM_O`Fwa@q@sFeDlA}BgBaBoGlEaDbGaMqAeM{BeB}GsB`DjDeBL{KuDeLmEqGiHqKdCoCgCmBAsF|HzKdIuD|XsJtQeD@_LuUqBmKuJpAiNtMwApFBjQmCbFcXfUjH[~FnAiBvDgOxP}UtOqAlHsSqAgYfHeK|Jw^dVlYqIzGf@g[vIkK|@id@xUqEe@HpCcMzFyKbK}BnFeTlHWbI",
  "kvVvjYoBsKkKgDoHIsJyG_`@TsGiCi@aCYgKzf@kGxGmCvMiQxAeL|P{PxK{DoIaRgEiCxBi]mFmOyGaCyF^eBuG|@_a@~CeT{FuTxBp@gA_QfBaFg@sB_AkAyDAr@|BoBfG^dBkVmJQ}b@tDyKdCiBPsGgAyAwE?wOsL_IsRcDcQ",
  "wjYh}W?~M",
  "wjYteYtC`D",
];

export const BORDERS = [
  "chMpiCXmE{BwAcKt@iLsTod@eJa[iBqVtA{\\o@uGfHyK}AcCf@y@hEaDeH}EXqEyCoQPkBlD{BXkBmGiHkGcMhM{FsD{WcHqFxBgAvC}Hz@eAaFfGgNgCsUiIyNeEHiCcDiPiC",
  "ijLoZkIHcQoDwDbBgJ}F_ESaAmKgFKkCoEiIkFsBxGqHq@h@aFzGoBcCePb@{Q_AmEiJaGk@{GqLaB{CcJhLiA]gV",
  "kd@njJjKiLtEe@zAwDdRwQtC@~D}D|KuUoDyIlLcMbDgMwB^oClFeKsMsHqAyFv@iByDgFm@oAsC_EcBwAj@gDeF_NcCqS{HbDaFwAqA}HzAeDbJwCZ{@{A",
  "_sOekHdEP`HeBnPbGxEwAhMaMpFWzS}GDvBdEuBjYbQ",
  "_sOekHcEBcAbDsK`Fq@tE|@hXuFeAuH~NmCzA_GrQFlG",
  "ovHw`DiTuRsNmGmRKyIaBcFbCkDyB{V]mKpAgLoBmKcJoANwGnKwVnAyQfJmHrGcLhB",
  "il@wjYp@HcBfVrBha@vVjq@}K~FiAdSjDdJdVaCpKdDfR|Za@fFxExLsEhSpBrDBvU{DjThDdf@mMrKmHdL|DfSzLzBuHle@tB|VdJhLhGhBrBpJpDdFyB`T`EdXrBdApAe@hCoKvBg@jB`@hBzGfDV",
  "pkHbmHqGiV`FmBxCyDnBuG[}D",
  "vfMjgD[tN{DrHcBdBgK_BoCxGOhHsLrDqAjK}AgAyGr@cHlFjBxQmP|AiDiA_BiEkDiBw@l@nCxJcAfKcEj@mJfG_HtK{KS",
  "nqH|}F|DyB~J`Op@rFyD`KxC|E",
  "ehKvjYl@cHaA{J",
  "yhKvuXLuH`EcMjLwEjIqL",
  "`vDeqAeF`LgK`AuL|EsMqAyChA",
  "o|IbrOkKiDiDv@gEoGmLe@sBgBoA{FkB{@d@aDiAwGuFsFX{DcE}KFqDyKgYTqFsJcPmMqCyIeM",
  "efGjlHyCL}@~EcG_@}BaGaGwEuHlKuEx@GtJcF{@uEdA{B{HoGsDkJu@}JbCyDkA}AyDeXoA{JhB}EpGsWjE",
  "`xWy}DhFnAzJlNfNL}BvGnOrBf@dCkEnJF|CgGvFwI~BuGeDPuCsH{CqBvEUpGaDbDbA`FoPvA",
  "efGjlHv@aFfIgHbAiGrJq@~KoFpEzCtJiHx@wAcEoDx@eDnKlCbK{FfKuAqD|KbNdIjMwPtDuBwG{IhEkD|JpBvA}BxHmCtOmCpCaItJqBF|GnFbA",
  "{cLfiJZiJ}D_HsFe[",
  "kd@njJaG`D{AdEuMp@oDoBiHr@cCkIgE{@{@yMiCa@kClByEcAaQfFuDO}IdFgMN{CoC_BB}NrDqB`F",
  "irCzkNgF{FmH{Ao@cG|ByE_AqBh@wGiGwBgAgE~@_DlIaCuFsDkHnC_LuAdA}GyC_K",
  "t`HhdP_DpBiSgDwJxCkI{DaFsH\\uFmOcJ[~LiGzHkGzAfAnD{F~JmB]JwJ}KgQa@aLaGCgCnKiD\\sM}BqCxGeCBtBePuA_GgDg@oB~BqFh@h@_GcByL",
  "hxBvlNp@_F`Bo@rIzG|JoEh@{ClKaC",
  "ijLoZhB{L|BmBfMeDvEcDxC`B",
  "xoF`g@|@pRpGpVvLb@h@`E_AvCcHdAmAtClBzJnJvFqAbGxAtB|H`BbFl@vFuCxHnCmGnXxEbNy@nDrK~EoFlHlBnI",
  "faDt}Mq@kBjBqJ",
  "rtGx{T@yE{ImMr@yD`OTxRkNz@kKmIoLh@yF~JqFfCsI@oBiBq@iFf@cKiEcCqHjNiYc@aDaJyE",
  "q`NwjYAjBcERq@zB|BrGuAnGaEdEaHNqBxFhAzEuBfFiBvCoLxD}AbEG|LlBhJhDfE_PhKq[tL}OvQ|Ab]h]ljAxH~SfT~_@rN~a@",
  "sgDddOlH_AzBvBBtFvFLbExEbMzD~@fCyBfEF~K|PpH{B|CfBtD_BvFtC|@dMuBzFv@dJeKnHjKzLNrCcAnDtD|KgBx@wA",
  "a}GddPlJrAxDdGhGrB|YWdI}FtMyClUuUrPgI",
  "o|IbrObC}@nYRdN|KfEr@~Aw@jGpE",
  "sgDddOzEiHjD_N`H?",
  "qgWptVdFDvO`G~O}GlJtCtDxD`N|D`A~GnF`B^fE",
  "vrHxqEsHtJhBfBg@hBwDzBEnH|G~ChBnF",
  "hxBvlNeJt@qEbDyFB_F}IiDqAgXGyQkEm@n@jBfDa@lB_JfOid@dHoXnB",
  "q`@tfO\\|BjLfI^zBaAlBeIjAfFtJoEfBj@jIwEnBqFbIpF|@",
  "rpQfiV`BeFl^_O~CbI`RoBlAgArKCnJuJxM[dFiJnGiAfJgF~CuBD_BjCtBjC{@}CmKdMqFvAwF",
  "rpQfiVeCsAeIfCc@nBhAlB",
  "lcQxqVgNzKeHmBkUzGeBiCcI}@eO|B",
  "rpQfiVR`JyLoA",
  "qyLhvWpG|AlCxG~FiCfCTxLnGl@~LfGX",
  "iaNxlWtDkAdHzCvFGbPfF",
  "iaNxlW}Bo@gCmG`EmKF}M{JmC_JsR?eB~JaIpJqD`KkTS}NgGyDKmGqBoB",
  "wgOvjYOuYjB_AlFkM`M_E`M{K",
  "{vGxoWyCnG",
  "{vGxoWrO}FdNwHfAyBxEX",
  "cwJxtVeEuAHsE_FkEg@wCjAuEqGgDyAzDkJlCmIjJaHtC@rDcRnBbDjSfCrC}AlD",
  "cwJxtVjEtAZbBbFHy@tM",
  "oxHhiUu@rDsTlPiPxCmPpG}BpASnC",
  "i}HwjYmBhIXjF",
  "tzJh}C~AdDpKlDdLgFvE|@hAqH",
  "vrHxqEvIw@bCgEqD{E}BcHNwCxF}BbDsEjJYlCeD~@yGfCxBdCCfBqExDdCdDiCnDrA`@zC`E{A",
  "pkHbmHaDd@cBrBuF`PiFuA{CjAe@vC_Rg@yEzEmVxFB`E`NjOpKn_@nEd`@sB|D",
  "lbDb}LnN}IdMDbAkBxCA~EuDfGrDaArAmDHpDpB|Jo@zKbAnMaB",
  "`cDvnMgDmLrCeC",
  "faDt}MjCQqAkM",
  "t`HhdPtIsPyAmF~@}HtNmA|H|Dk@vD|BvBpHrAh@cDoE}B}@wEdAyDmDcIwK{GkBeLmIqCmPcRhCkDoByBaG}@{AfCqELqLaI",
  "kd@njJf@lKvAdBfAj@tG_CbDhN`U~IjEtE}G`NrAvJkEr@_@~Az@hKrHmCx@yE~BaAnHdAxKwDd@xE~TdAjNlEpCdCbK|@zAMxCsGhS{AvBxK~GtD_@yDfEiAB{B~BcCfIiDvCfB~DE",
  "irCzkNjDnCPrGdH}@nNdErIQlN~AbOvM|g@wF",
  "{vGxoWgDaEvCcHj@gNeGuAq@iMkGuGeH~AbD}NiKm@",
  "oxHhiU_DqCyFl@w@yDVeCtLaPuOsCdAeCfJsHvHqC~@yBUwJ_EiKw@_LtD{@hMrCvF{AtAqFjCeB``@cAtG`DdGmDfFlBvQmAnIwE~DzDzKW~I~MpL_KbIQdBp]{QfOkE~SqCbEqh@fg@yHjCo@tHkRrRBfB|At@",
  "ygHlmRVkAiC}@MiBvAeJgBg@AcBiGh@cCWKyAjSiJgAgGpFkDc@}BfE_KuA}E",
  "{tDjqJmFgP}N?iK_DcMiLoAqLyGeEsHqJqIcA",
  "a`E`zKlMwXgB}M",
  "a`E`zK_GPsT`M{k@mC_AaNkD}BiXiE{BoFwA_@eLdDiAg@uOaKqDwOePeBmHv@gPeDeO`LeOwE",
  "mnAhxEiGsZdDoM~F_CMeFdEcMaEoPjBsJnDoFoAwJtCaGnO{NmJoUdHas@",
  "gjMjdKlEqIzGOnBqCfGmAvD{HpDX",
  "clWduRjQt@bHs@lIsHvErBzBeAlKZnQyEl[hJrKvFjKzJnCbG|MjH~Ox@nd@s@xHvB~LLbd@WzMxCxAw@VwDyEaIlP{G",
  "o|IbrOoEtGmJdEcFtGcBk@{AlRgKzGcWnHpAhGbB`AsHlEfGtBKlA",
  "utOvjY_B{BqS_B{Q}Fu@}CePkA}C_BwEzEaInCmBeB}FVuMdEwYuIkF@eIaFb@kHvDwHo@_CqCaAkJh@}HzCqAzDo@|IvKnIkBjR",
  "qjJriWtLfE|AcBb@qFvBVrOh`@wCxEC|L",
  "qrRvrIuFe@cIdDcV`_@yO|PeMbL_KfFoKjT{A|KDda@kFrTlBdCuGvG",
  "gjMjdKuFgDcBcE}AEkIbD_K{@iWjAgQuC{OhK{Ba@gSsOc^kJ}BuNqLqE",
  "qpLvxHwK|@o@cBrFsECuG~DiO}@_D_KgUaXgd@cJ_C{BcHT_EzEyI}C}CVy@nD}BtPiVD_ElC}F",
  "_wH}iBkRo@cFxCqTnEqRiAgBxDwGvDrA~TgDxL",
  "_wW|YlJeKrAgOtEgHWqC|OcMeByL_I_B_HjCaKgAeHeJQqCcGcFn@qDxJ}DpBsHnJcBfQzAd@sNrRsEbLcN~Co@SyHnOaFb@gHiBsIfAuD~FcGe@{GxAwJjKwBnGoElHy@fJxArMbNnEsDt@uIjMqAtFlF`JcG`IxClEyC",
  "_wW|YsHh@aE}@mDcEc@mLoTiB_GaG",
  "_sOekHFyHgBcIoFwEvCoBjIgQbAyMrGgVmFoSm@mOiFoGnEmE",
  "giKas@p`AzDf}@x@",
  "~cIxdHkHlF_G_BaFzB",
  "`[`wTfAhBm@xA}AMo@sBNoAbBL",
  "qrRvrIwGuIoPiAcCeDgBPwDsDaLt@gJlCcBzBoHU{Ad@UvCuB]sAlBgAwCoJIgH|H_H}AwE~JYfS{TrI[`IiDpIgOzDuClE_AvKoJrD|@tBtInCrFgDpBjCpNg@jB~E~AsHvHxECzEgEzJZfHhGzHY|DtGdNmA`IvGfB~BfC",
  "aeQcsEpGrEfFhLZfGlS|@pB~@rBbGdGpC",
  "ibVddOmE~DeFjAuNV@kDuDDcMgJkGcBqGp@iG`E",
  "_|K`eRiGp@cEzC{Ll@cEnA}B~CeD}@kE}G_F_BqFzAgD~CrGdB~@rFcKhK",
  "chMpiCpC{KmAkFd@aO~A_CrR_IsFgPqO}Ky@wF|DeVvN{^dGwU",
];

// Decode an array of encoded polylines to Array<Float32Array> of
// [x0, y0, x1, y1, ...] in km on the display plane.
export function decodePolylines(encoded) {
  return encoded.map((str) => {
    const vals = [];
    let i = 0;
    while (i < str.length) {
      let result = 0;
      let shift = 0;
      let b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      vals.push(result & 1 ? ~(result >> 1) : result >> 1);
    }
    const out = new Float32Array(vals.length);
    let px = 0;
    let py = 0;
    for (let j = 0; j < vals.length; j += 2) {
      px += vals[j];
      py += vals[j + 1];
      out[j] = px * 0.1;
      out[j + 1] = py * 0.1;
    }
    return out;
  });
}
