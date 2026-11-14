"""
tests/test_dimensional_drawing_empirical.py
Empirical Adversarial Verification and Stress Suite for DIMENSIONAL_DRAWING_ASSESSMENT.md
"""

import math
from fractions import Fraction
import pytest

class TestProjectionMathematics:
    """Rigorous empirical verification of affine projection equations."""

    def test_exact_rational_determinant(self):
        """Prove det(M) = 0.4996 * sc^2 using exact fraction arithmetic."""
        ia_coeff = Fraction(94, 100)
        ib_coeff = Fraction(17, 100)
        ic_coeff = Fraction(-34, 100)
        id_coeff = Fraction(47, 100)

        det_coeff = (ia_coeff * id_coeff) - (ib_coeff * ic_coeff)
        expected = Fraction(4996, 10000)

        assert det_coeff == expected
        assert float(det_coeff) == 0.4996
        assert det_coeff > 0

    def test_exact_rational_svd_anisotropy_ratio(self):
        """
        Prove that the singular value anisotropy ratio is EXACTLY 2.0
        due to the discriminant being an exact rational square (0.7494^2).
        """
        ia = Fraction(94, 100)
        ib = Fraction(17, 100)
        ic = Fraction(-34, 100)
        id = Fraction(47, 100)

        m11 = ia * ia + ib * ib         # 9125 / 10000
        m12 = ia * ic + ib * id         # -2397 / 10000
        m22 = ic * ic + id * id         # 3365 / 10000

        tr = m11 + m22                  # 12490 / 10000 = 1.249
        det = m11 * m22 - m12 * m12     # (4996/10000)^2

        disc = tr * tr - 4 * det        # 56160036 / 100000000
        
        # Check if discriminant is an exact square of 7494 / 10000
        expected_root = Fraction(7494, 10000)
        assert disc == expected_root * expected_root

        # Eigenvalues
        lambda1 = (tr + expected_root) / 2  # 19984 / 20000 = 9992 / 10000 = 0.9992
        lambda2 = (tr - expected_root) / 2  # 4996 / 20000 = 2498 / 10000 = 0.2498

        assert lambda1 == Fraction(9992, 10000)
        assert lambda2 == Fraction(2498, 10000)

        # Ratio of eigenvalues is exactly 4
        assert lambda1 / lambda2 == Fraction(4, 1)

        # Ratio of singular values is exactly sqrt(4) = 2.0
        assert math.isclose(math.sqrt(float(lambda1 / lambda2)), 2.0, rel_tol=1e-15)

    def test_affine_projection_point_mapping(self):
        """Empirically test SVG affine matrix coordinates against P(x, y, z)."""
        sc = 0.45
        TX = 330.0
        TY = 560.0
        ia = 0.94 * sc
        ib = 0.17 * sc
        ic = -0.34 * sc
        id = 0.47 * sc

        def P(x, y, z):
            return [TX + ia * x + ic * y, TY + ib * x + id * y - z]

        test_points = [
            (0, 0, 0),
            (100, 200, 50),
            (460, 340, 48),
            (-150, 80, -25),
            (999999.0, -888888.0, 12345.0)
        ]

        for x, y, z in test_points:
            px, py = P(x, y, z)
            svg_x = ia * x + ic * y + TX
            svg_y = ib * x + id * y + (TY - z)
            assert math.isclose(px, svg_x, rel_tol=1e-12)
            assert math.isclose(py, svg_y, rel_tol=1e-12)

    def test_stroke_invariant_normalization(self):
        """Verify stroke normalization factor --u maintains constant area scaling."""
        for sc in [0.1, 0.25, 0.45, 1.0, 2.0]:
            det = 0.4996 * (sc ** 2)
            u = 1.0 / math.sqrt(det)
            assert math.isclose(u * math.sqrt(det), 1.0, rel_tol=1e-14)

        # Verify sc = 0.45 baseline
        u_base = 1.0 / math.sqrt(0.4996 * (0.45 ** 2))
        assert f"{u_base:.4f}" == "3.1440"

    def test_morphing_determinant_positivity(self):
        """Stress-test morphing interpolation to verify determinant never reaches 0."""
        for k in [0.25, 0.5, 0.9, 1.0, 1.1, 4.0]:
            for sc in [0.2, 0.45, 1.0]:
                ia = 0.94 * sc
                ib = 0.17 * sc
                ic = -0.34 * sc
                id = 0.47 * sc

                for step in range(501):
                    v = step / 500.0
                    m0 = (1.0 - v) * k + v * ia
                    m1 = v * ib
                    m2 = v * ic
                    m3 = (1.0 - v) * k + v * id
                    det_v = m0 * m3 - m1 * m2
                    assert det_v > 0.0, f"Determinant collapsed at v={v}, k={k}, sc={sc}"


class TestBoundaryConditions:
    """Stress testing boundary cases and extreme values."""

    def test_singularity_at_scale_zero(self):
        """At sc=0, matrix is singular and determinant collapses to 0."""
        sc = 0.0
        det = 0.4996 * (sc ** 2)
        assert det == 0.0
        with pytest.raises(ZeroDivisionError):
            _ = 1.0 / math.sqrt(det)

    def test_negative_z_coordinate(self):
        """Negative z moves down in SVG screen space without affecting x."""
        sc = 0.45
        TX, TY = 330.0, 560.0
        ia, ib, ic, id = 0.94 * sc, 0.17 * sc, -0.34 * sc, 0.47 * sc

        def P(x, y, z):
            return (TX + ia * x + ic * y, TY + ib * x + id * y - z)

        x_ground, y_ground = P(50, 50, 0)
        x_neg, y_neg = P(50, 50, -100)

        assert x_ground == x_neg
        assert y_neg == y_ground + 100.0  # Screen Y increases downwards

    def test_coordinate_coupling_with_nan(self):
        """Demonstrate that shear terms couple x and y coordinates under NaN input."""
        sc = 0.45
        TX, TY = 330.0, 560.0
        ia, ib, ic, id = 0.94 * sc, 0.17 * sc, -0.34 * sc, 0.47 * sc

        def P(x, y, z):
            return (TX + ia * x + ic * y, TY + ib * x + id * y - z)

        px, py = P(float('nan'), 0, 0)
        assert math.isnan(px)
        assert math.isnan(py), "Due to shear coupling (ib * x), py must become NaN"


class TestPerformanceBandwidth:
    """Verify memory bandwidth calculations for CanvasTexture."""

    def test_pcie_saturation_calculation(self):
        """Verify 503.3 MB/s PCIe continuous bandwidth calculation at 60 FPS."""
        width = 2048
        height = 1024
        bpp = 4  # RGBA8
        fps = 60

        bytes_per_frame = width * height * bpp
        total_bandwidth_per_sec = bytes_per_frame * fps

        assert bytes_per_frame == 8388608  # 8.3886 MB
        assert total_bandwidth_per_sec == 503316480  # 503.3 MB/s
        assert total_bandwidth_per_sec > 500 * 1000 * 1000
