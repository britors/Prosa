//! Geometria física compartilhada por edição, paginação e impressão.

const MM_PER_INCH: f64 = 25.4;
const POINTS_PER_INCH: f64 = 72.0;
pub const SCREEN_DPI: f64 = 96.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageGeometry {
    pub width_mm: f64,
    pub height_mm: f64,
    pub margin_top_mm: f64,
    pub margin_bottom_mm: f64,
    pub margin_left_mm: f64,
    pub margin_right_mm: f64,
    pub header_height_mm: f64,
    pub footer_height_mm: f64,
    pub page_gap_mm: f64,
}

impl PageGeometry {
    /// A4 com o preset acadêmico já usado pelo Prosa.
    pub const fn academic_a4() -> Self {
        Self {
            width_mm: 210.0,
            height_mm: 297.0,
            margin_top_mm: 24.892,
            margin_bottom_mm: 24.892,
            margin_left_mm: 20.066,
            margin_right_mm: 20.066,
            header_height_mm: 8.466_666_666_7,
            footer_height_mm: 8.466_666_666_7,
            page_gap_mm: 8.466_666_666_7,
        }
    }

    pub fn from_setup(setup: prosa_doc::PageSetup) -> Self {
        Self {
            width_mm: setup.width_mm,
            height_mm: setup.height_mm,
            margin_top_mm: setup.margin_top_mm,
            margin_bottom_mm: setup.margin_bottom_mm,
            margin_left_mm: setup.margin_left_mm,
            margin_right_mm: setup.margin_right_mm,
            header_height_mm: setup.header_height_mm,
            footer_height_mm: setup.footer_height_mm,
            page_gap_mm: setup.page_gap_mm,
        }
    }

    pub fn to_setup(self) -> prosa_doc::PageSetup {
        prosa_doc::PageSetup {
            width_mm: self.width_mm,
            height_mm: self.height_mm,
            margin_top_mm: self.margin_top_mm,
            margin_bottom_mm: self.margin_bottom_mm,
            margin_left_mm: self.margin_left_mm,
            margin_right_mm: self.margin_right_mm,
            header_height_mm: self.header_height_mm,
            footer_height_mm: self.footer_height_mm,
            page_gap_mm: self.page_gap_mm,
        }
    }

    pub fn usable_width_mm(self) -> f64 {
        self.width_mm - self.margin_left_mm - self.margin_right_mm
    }

    /// Área exclusiva do corpo, sem margens nem bandas de cabeçalho/rodapé.
    pub fn usable_height_mm(self) -> f64 {
        self.height_mm
            - self.margin_top_mm
            - self.header_height_mm
            - self.footer_height_mm
            - self.margin_bottom_mm
    }

    pub fn body_top_mm(self) -> f64 {
        self.margin_top_mm + self.header_height_mm
    }

    pub fn mm_to_points(mm: f64) -> f64 {
        mm / MM_PER_INCH * POINTS_PER_INCH
    }

    pub fn mm_to_pixels(mm: f64, dpi: f64) -> i32 {
        (mm / MM_PER_INCH * dpi).round() as i32
    }

    pub fn width_px(self) -> i32 {
        Self::mm_to_pixels(self.width_mm, SCREEN_DPI)
    }

    #[allow(dead_code)] // Consumido pelo `PagedEditor` na etapa seguinte.
    pub fn height_px(self) -> i32 {
        Self::mm_to_pixels(self.height_mm, SCREEN_DPI)
    }

    pub fn height_points(self) -> f64 {
        Self::mm_to_points(self.height_mm)
    }

    pub fn usable_width_points(self) -> f64 {
        Self::mm_to_points(self.usable_width_mm())
    }

    pub fn usable_height_points(self) -> f64 {
        Self::mm_to_points(self.usable_height_mm())
    }

    pub fn body_top_points(self) -> f64 {
        Self::mm_to_points(self.body_top_mm())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a4_conversions_match_physical_dimensions() {
        let page = PageGeometry::academic_a4();
        assert_eq!(page.width_px(), 794);
        assert_eq!(page.height_px(), 1123);
        assert!((PageGeometry::mm_to_points(page.width_mm) - 595.276).abs() < 0.001);
        assert!((PageGeometry::mm_to_points(page.height_mm) - 841.89).abs() < 0.001);
    }

    #[test]
    fn usable_area_excludes_margins_header_and_footer() {
        let page = PageGeometry::academic_a4();
        let occupied = page.margin_top_mm
            + page.header_height_mm
            + page.usable_height_mm()
            + page.footer_height_mm
            + page.margin_bottom_mm;
        assert!((occupied - page.height_mm).abs() < 1e-9);
        assert!(page.usable_width_mm() < page.width_mm);
        assert!(page.usable_height_mm() < page.height_mm);
    }

    #[test]
    fn custom_margin_changes_both_pixel_and_point_results() {
        let mut page = PageGeometry::academic_a4();
        let old_body_px = PageGeometry::mm_to_pixels(page.usable_width_mm(), SCREEN_DPI);
        let old_body_pt = PageGeometry::mm_to_points(page.usable_width_mm());
        page.margin_left_mm += 10.0;
        assert!(PageGeometry::mm_to_pixels(page.usable_width_mm(), SCREEN_DPI) < old_body_px);
        assert!(PageGeometry::mm_to_points(page.usable_width_mm()) < old_body_pt);
    }

    #[test]
    fn persisted_setup_round_trips_without_losing_geometry() {
        let mut page = PageGeometry::academic_a4();
        page.margin_left_mm = 31.5;
        page.margin_bottom_mm = 18.25;
        assert_eq!(PageGeometry::from_setup(page.to_setup()), page);
    }
}
