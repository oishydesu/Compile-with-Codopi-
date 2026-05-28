%{
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

extern int yylex(void);
extern int yylineno;
extern FILE* yyin;

void yyerror(const char* message);

FILE* out;
int errorCount = 0;

char* symbols[1024];
int symbolCount = 0;

char* makeCode(const char* format, ...) {
    va_list args;
    va_start(args, format);

    va_list argsCopy;
    va_copy(argsCopy, args);

    int length = vsnprintf(NULL, 0, format, argsCopy);
    va_end(argsCopy);

    char* buffer = (char*)malloc(length + 1);
    vsnprintf(buffer, length + 1, format, args);

    va_end(args);
    return buffer;
}

int isDeclared(const char* name) {
    for (int i = 0; i < symbolCount; i++) {
        if (strcmp(symbols[i], name) == 0) {
            return 1;
        }
    }

    return 0;
}

void declareVar(const char* name) {
    if (symbolCount < 1024) {
        symbols[symbolCount] = makeCode("%s", name);
        symbolCount++;
    }
}

void semanticError(const char* message, const char* name) {
    fprintf(stderr, "Semantic Error at line %d: %s '%s'\n", yylineno, message, name);
    errorCount++;
}
%}

%union {
    char* str;
}

%token LET PRINT IF ELSE WHILE
%token <str> NUMBER ID
%token EQ NE LE GE

%type <str> statements statement block expr condition

%left EQ NE '<' '>' LE GE
%left '+' '-'
%left '*' '/'
%right UMINUS

%nonassoc LOWER_THAN_ELSE
%nonassoc ELSE

%%

program:
    statements
    {
        fprintf(out, "#include <stdio.h>\n\n");
        fprintf(out, "int main() {\n");
        fprintf(out, "%s", $1);
        fprintf(out, "return 0;\n");
        fprintf(out, "}\n");

        free($1);
    }
    ;

statements:
      /* empty */
      {
          $$ = makeCode("");
      }

    | statements statement
      {
          $$ = makeCode("%s%s", $1, $2);
          free($1);
          free($2);
      }
    ;

statement:
      LET ID '=' expr ';'
      {
          if (isDeclared($2)) {
              semanticError("Variable already declared", $2);
              $$ = makeCode("");
          } else {
              declareVar($2);
              $$ = makeCode("int %s = %s;\n", $2, $4);
          }

          free($2);
          free($4);
      }

    | ID '=' expr ';'
      {
          if (!isDeclared($1)) {
              semanticError("Undeclared variable", $1);
              $$ = makeCode("");
          } else {
              $$ = makeCode("%s = %s;\n", $1, $3);
          }

          free($1);
          free($3);
      }

    | PRINT expr ';'
      {
          $$ = makeCode("printf(\"%%d\\n\", %s);\n", $2);
          free($2);
      }

    | IF '(' condition ')' block %prec LOWER_THAN_ELSE
      {
          $$ = makeCode("if (%s) %s", $3, $5);
          free($3);
          free($5);
      }

    | IF '(' condition ')' block ELSE block
      {
          $$ = makeCode("if (%s) %selse %s", $3, $5, $7);
          free($3);
          free($5);
          free($7);
      }

    | WHILE '(' condition ')' block
      {
          $$ = makeCode("while (%s) %s", $3, $5);
          free($3);
          free($5);
      }
    ;

block:
      '{' statements '}'
      {
          $$ = makeCode("{\n%s}\n", $2);
          free($2);
      }
    ;

condition:
      expr '<' expr
      {
          $$ = makeCode("%s < %s", $1, $3);
          free($1);
          free($3);
      }

    | expr '>' expr
      {
          $$ = makeCode("%s > %s", $1, $3);
          free($1);
          free($3);
      }

    | expr LE expr
      {
          $$ = makeCode("%s <= %s", $1, $3);
          free($1);
          free($3);
      }

    | expr GE expr
      {
          $$ = makeCode("%s >= %s", $1, $3);
          free($1);
          free($3);
      }

    | expr EQ expr
      {
          $$ = makeCode("%s == %s", $1, $3);
          free($1);
          free($3);
      }

    | expr NE expr
      {
          $$ = makeCode("%s != %s", $1, $3);
          free($1);
          free($3);
      }

    | expr
      {
          $$ = makeCode("%s != 0", $1);
          free($1);
      }
    ;

expr:
      expr '+' expr
      {
          $$ = makeCode("(%s + %s)", $1, $3);
          free($1);
          free($3);
      }

    | expr '-' expr
      {
          $$ = makeCode("(%s - %s)", $1, $3);
          free($1);
          free($3);
      }

    | expr '*' expr
      {
          $$ = makeCode("(%s * %s)", $1, $3);
          free($1);
          free($3);
      }

    | expr '/' expr
      {
          $$ = makeCode("(%s / %s)", $1, $3);
          free($1);
          free($3);
      }

    | '-' expr %prec UMINUS
      {
          $$ = makeCode("(-%s)", $2);
          free($2);
      }

    | '(' expr ')'
      {
          $$ = makeCode("(%s)", $2);
          free($2);
      }

    | NUMBER
      {
          $$ = $1;
      }

    | ID
      {
          if (!isDeclared($1)) {
              semanticError("Undeclared variable", $1);
          }

          $$ = makeCode("%s", $1);
          free($1);
      }
    ;

%%

void yyerror(const char* message) {
    fprintf(stderr, "Syntax Error at line %d: %s\n", yylineno, message);
    errorCount++;
}

int main(int argc, char** argv) {
    if (argc < 3) {
        fprintf(stderr, "Usage: codopi_lang_compiler.exe input.copi output.c\n");
        return 1;
    }

    yyin = fopen(argv[1], "r");

    if (!yyin) {
        fprintf(stderr, "Could not open input file: %s\n", argv[1]);
        return 1;
    }

    out = fopen(argv[2], "w");

    if (!out) {
        fprintf(stderr, "Could not create output file: %s\n", argv[2]);
        fclose(yyin);
        return 1;
    }

    int parseResult = yyparse();

    fclose(yyin);
    fclose(out);

    if (parseResult != 0 || errorCount > 0) {
        return 1;
    }

    return 0;
}