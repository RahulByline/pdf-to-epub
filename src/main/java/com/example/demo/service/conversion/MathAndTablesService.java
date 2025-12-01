package com.example.demo.service.conversion;

import com.example.demo.dto.conversion.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

@Service
public class MathAndTablesService {

    private static final Logger logger = LoggerFactory.getLogger(MathAndTablesService.class);
    
    private static final Pattern MATH_PATTERN = Pattern.compile(
        ".*[∑∫∂∇√∞±≤≥≠≈∝αβγδεζηθικλμνξοπρστυφχψω].*|.*\\$.*\\$.*|.*\\(.*\\)|.*\\[.*\\].*"
    );

    public DocumentStructure processMathAndTables(DocumentStructure structure) {
        // Detect and convert math equations
        structure = processMathEquations(structure);
        
        // Enhance table structures
        structure = enhanceTableStructures(structure);
        
        // Process special widgets
        structure = processSpecialWidgets(structure);
        
        return structure;
    }

    private DocumentStructure processMathEquations(DocumentStructure structure) {
        List<MathEquation> equations = new ArrayList<>();
        int equationId = 0;

        for (PageStructure page : structure.getPages()) {
            for (TextBlock block : page.getTextBlocks()) {
                if (containsMath(block.getText())) {
                    MathEquation equation = extractMathEquation(block, equationId++);
                    if (equation != null) {
                        equations.add(equation);
                    }
                }
            }
        }

        structure.setEquations(equations);
        return structure;
    }

    private boolean containsMath(String text) {
        return MATH_PATTERN.matcher(text).find() ||
               text.matches(".*[a-zA-Z]\\s*=\\s*[0-9].*") || // Simple equations
               text.matches(".*\\^[0-9].*") || // Exponents
               text.matches(".*\\/[0-9].*"); // Fractions
    }

    private MathEquation extractMathEquation(TextBlock block, int id) {
        MathEquation equation = new MathEquation();
        equation.setId("math_" + id);
        equation.setOriginalText(block.getText());
        equation.setBoundingBox(block.getBoundingBox());
        equation.setIsInline(!block.getText().contains("\n"));
        equation.setConfidence(0.8);
        
        // Convert to LaTeX (simplified - in production use ML-based conversion)
        String latex = convertToLaTeX(block.getText());
        equation.setLatex(latex);
        
        // Convert to MathML (simplified)
        String mathml = convertToMathML(latex);
        equation.setMathml(mathml);
        
        return equation;
    }

    private String convertToLaTeX(String text) {
        // Simplified LaTeX conversion
        // In production, use sophisticated math recognition
        String latex = text;
        
        // Basic conversions
        latex = latex.replace("√", "\\sqrt{");
        latex = latex.replace("∑", "\\sum");
        latex = latex.replace("∫", "\\int");
        latex = latex.replace("α", "\\alpha");
        latex = latex.replace("β", "\\beta");
        latex = latex.replace("π", "\\pi");
        
        return latex;
    }

    private String convertToMathML(String latex) {
        // Simplified MathML conversion
        // In production, use a proper LaTeX to MathML converter
        return "<math xmlns=\"http://www.w3.org/1998/Math/MathML\"><mi>" + 
               latex.replace("\\", "") + "</mi></math>";
    }

    private DocumentStructure enhanceTableStructures(DocumentStructure structure) {
        for (TableStructure table : structure.getTables()) {
            // Generate HTML representation
            String html = generateTableHTML(table);
            table.setHtmlContent(html);
            
            // Improve confidence based on structure
            if (table.getTableBlock().getRows() > 1 && 
                table.getTableBlock().getColumns() > 1) {
                table.setConfidence(Math.min(1.0, table.getConfidence() + 0.1));
            }
        }

        return structure;
    }

    private String generateTableHTML(TableStructure table) {
        StringBuilder html = new StringBuilder();
        html.append("<table>");
        
        TableBlock tableBlock = table.getTableBlock();
        
        // Header row
        if (tableBlock.getHasHeaderRow() && !tableBlock.getHeaders().isEmpty()) {
            html.append("<thead><tr>");
            for (String header : tableBlock.getHeaders()) {
                html.append("<th>").append(escapeHtml(header)).append("</th>");
            }
            html.append("</tr></thead>");
        }
        
        // Body rows
        html.append("<tbody>");
        int startRow = tableBlock.getHasHeaderRow() ? 1 : 0;
        for (int i = startRow; i < tableBlock.getCells().size(); i++) {
            html.append("<tr>");
            for (TableCell cell : tableBlock.getCells().get(i)) {
                String tag = cell.getIsHeader() ? "th" : "td";
                html.append("<").append(tag);
                if (cell.getRowSpan() > 1) {
                    html.append(" rowspan=\"").append(cell.getRowSpan()).append("\"");
                }
                if (cell.getColSpan() > 1) {
                    html.append(" colspan=\"").append(cell.getColSpan()).append("\"");
                }
                html.append(">").append(escapeHtml(cell.getContent())).append("</").append(tag).append(">");
            }
            html.append("</tr>");
        }
        html.append("</tbody>");
        html.append("</table>");
        
        return html.toString();
    }

    private String escapeHtml(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;")
                   .replace("<", "&lt;")
                   .replace(">", "&gt;")
                   .replace("\"", "&quot;")
                   .replace("'", "&#39;");
    }

    private DocumentStructure processSpecialWidgets(DocumentStructure structure) {
        // Identify special interactive widgets
        // "Try it yourself", "Check your understanding", etc.
        
        for (PageStructure page : structure.getPages()) {
            for (TextBlock block : page.getTextBlocks()) {
                String text = block.getText().toLowerCase();
                
                if (text.contains("try it yourself") || 
                    text.contains("check your understanding") ||
                    text.contains("practice") ||
                    text.contains("interactive")) {
                    
                    // Mark as special widget (would add metadata in production)
                    block.setType(TextBlock.BlockType.EXERCISE);
                }
            }
        }

        return structure;
    }
}

