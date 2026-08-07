import subprocess
import sys

def install(package):
    subprocess.check_call([sys.executable, "-m", "pip", "install", package])

try:
    from fpdf import FPDF
except ImportError:
    install('fpdf2')
    from fpdf import FPDF

pdf = FPDF()
pdf.add_page()
pdf.set_font("Helvetica", size=16, style='B')
pdf.cell(200, 10, txt="Lab Report: Introduction to Python Programming", ln=1, align='C')
pdf.ln(10)

pdf.set_font("Helvetica", size=12, style='B')
pdf.cell(200, 10, txt="Task 1: Basic Arithmetic", ln=1)
pdf.set_font("Helvetica", size=12)
pdf.multi_cell(0, 8, txt="Description: Write a Python script to define two variables, x = 42 and y = 15. Calculate their sum and print the result. This will test the solver's basic code generation and execution capabilities.")
pdf.ln(5)

pdf.set_font("Helvetica", size=12, style='B')
pdf.cell(200, 10, txt="Task 2: Data Generation", ln=1)
pdf.set_font("Helvetica", size=12)
pdf.multi_cell(0, 8, txt="Description: Import the random library. Generate a list of 5 random integers between 1 and 50. Print the list to the console. This tests importing standard libraries and verifying output.")
pdf.ln(5)

pdf.set_font("Helvetica", size=12, style='B')
pdf.cell(200, 10, txt="Task 3: Theoretical Analysis", ln=1)
pdf.set_font("Helvetica", size=12)
pdf.multi_cell(0, 8, txt="Description: Briefly explain the conceptual difference between a Python list and a tuple. This tests the solver's ability to handle purely theoretical questions without generating code.")

pdf.output("d:/Lab_Solver/test_lab_report.pdf")
print("PDF created successfully at d:/Lab_Solver/test_lab_report.pdf")
